import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  formatDateTime,
  type AdminBookingDto,
  type AdminBookingQuery,
  type BillingMode,
  type BookingDto,
  type BookingResult,
  type CreateBookingInput,
  type ListingPromotionOption,
  type MyBillingOverview,
  type Paginated,
  type ProductCode,
  type ProductUsage,
  PROMOTION_CODES,
} from '@marktat/shared';
import { Prisma, type Booking, type Listing, type Payment, type Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { loadEnv } from '../config/env.js';
import type { AuthUser } from '../auth/auth.types.js';
import { effectiveStatus } from '../listings/listings.mapper.js';
import { PricingService } from './pricing.service.js';
import { STRIPE_GATEWAY, StripeUnavailableError, type CheckoutSession, type StripeGateway } from './stripe.gateway.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Nicht abgeschlossene Zahlungen verfallen danach (die Stripe-Session gilt 30 Minuten) */
const PENDING_TIMEOUT_MS = 2 * HOUR_MS;
const EXPIRY_INTERVAL_MS = 5 * 60_000;
const PAGE_SIZE = 25;

/** Status, die für Limits zählen (abgebrochene und erstattete Buchungen nicht) */
const COUNTED_STATUSES = ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'EXPIRED'] as const;

const bookingInclude = {
  product: { select: { code: true, name: true, kind: true } },
  listing: { select: { id: true, title: true } },
  payment: true,
} satisfies Prisma.BookingInclude;
type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Veröffentlichen eines Inserats nach bezahlter Buchung – stellt das Inseratsmodul bereit (vermeidet Zyklen). */
export interface ListingBookingHandler {
  /** Prüft vor einer kostenpflichtigen Buchung, ob das Inserat veröffentlicht werden kann (wirft 400/409). */
  assertPublishable(userId: string, listingId: string): Promise<void>;
  /** Veröffentlicht bzw. verlängert das Inserat; gibt das neue Ablaufdatum zurück. */
  activate(tx: Tx, listingId: string, durationDays: number, now: Date): Promise<Date>;
}

interface Evaluation {
  available: boolean;
  reason: string | null;
  activeUntil: Date | null;
  nextAvailableAt: Date | null;
}

type ListingForBooking = Pick<
  Listing,
  'id' | 'sellerId' | 'status' | 'expiresAt' | 'deletedAt' | 'publishedAt' | 'createdAt' | 'bumpedAt' | 'highlightedUntil' | 'topUntil' | 'title'
>;

/**
 * Zentrale Buchungslogik für kostenlose und (später) bezahlte Leistungen.
 *
 * - Kostenlos (effektiver Preis 0): Berechtigung und Limits prüfen, Buchung speichern, Leistung sofort aktivieren.
 * - Kostenpflichtig: Buchung „wartet auf Zahlung“, Stripe Checkout; aktiviert wird erst nach serverseitiger
 *   Bestätigung (signierter Webhook oder Abruf der Session bei Stripe) – nie durch den Browser.
 * - Alle Prüfungen laufen pro Konto nacheinander (Advisory-Lock), damit parallele Anfragen Limits nicht umgehen.
 */
@Injectable()
export class BookingsService implements OnModuleInit {
  private readonly logger = new Logger(BookingsService.name);
  private listingHandler?: ListingBookingHandler;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly searchIndex: SearchIndexService,
    private readonly jobs: JobsService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  onModuleInit() {
    this.jobs.register('promotion-expiry', () => this.expire().then(() => undefined));
    this.jobs.every('promotion-expiry', EXPIRY_INTERVAL_MS);
  }

  registerListingHandler(handler: ListingBookingHandler) {
    this.listingHandler = handler;
  }

  // --- Inserat veröffentlichen (vom Inseratsmodul aufgerufen) ---------------------------------------

  /**
   * Preis und Laufzeit fürs Veröffentlichen bzw. Verlängern. `requiresPayment` = im kostenpflichtigen Betrieb
   * nur über eine Buchung mit Zahlung möglich.
   */
  async listingTerms(user: Pick<AuthUser, 'accountType'>, db: Db = this.prisma) {
    const product = await this.pricing.product('listing', db);
    if (!this.pricing.availableFor(product, user.accountType)) {
      throw new ForbiddenException(
        user.accountType === 'BUSINESS'
          ? 'Inserate sind für gewerbliche Konten derzeit nicht verfügbar.'
          : 'Inserate sind für private Konten derzeit nicht verfügbar.',
      );
    }
    const settings = await this.pricing.settings(db);
    const mode = this.pricing.effectiveMode(settings);
    const price = this.pricing.quote(product, mode);
    return { product, mode, price, durationDays: product.durationDays ?? (await this.pricing.listingDurationDays(db)) };
  }

  /** Kostenlose Inseratsbuchung festhalten (Nachweis: 0,00 € zum Zeitpunkt der Veröffentlichung). */
  async recordFreeListing(tx: Tx, input: { userId: string; listingId: string; product: Product; mode: BillingMode; startsAt: Date; endsAt: Date }) {
    await tx.booking.create({
      data: {
        userId: input.userId,
        listingId: input.listingId,
        productId: input.product.id,
        kind: 'LISTING',
        status: 'ACTIVE',
        priceCents: 0,
        currency: input.product.currency,
        billingMode: input.mode,
        snapshot: this.snapshot(input.product, input.mode, 0, input.startsAt),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
  }

  // --- Buchen -------------------------------------------------------------------------------------------

  async create(user: AuthUser, listingId: string, input: CreateBookingInput, ip?: string): Promise<BookingResult> {
    const replay = await this.findByKey(user.id, input.idempotencyKey);
    if (replay) return this.replay(replay, listingId, input.product);

    await this.requireOwnedListing(user.id, listingId);
    if (input.product === 'listing') {
      const terms = await this.listingTerms(user);
      if (!terms.price.requiresPayment) {
        throw new BadRequestException('Inserate sind derzeit kostenlos – bitte veröffentliche es direkt unter „Meine Anzeigen“.');
      }
      if (!this.listingHandler) throw new ServiceUnavailableException('Veröffentlichen ist gerade nicht möglich.');
      await this.listingHandler.assertPublishable(user.id, listingId);
    }

    const now = new Date();
    let outcome: { booking: BookingWithRelations; needsCheckout: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, `booking:${user.id}`);
        const product = await this.pricing.product(input.product, tx);
        if (product.maxActiveTotal !== null) await this.lock(tx, `booking-total:${product.code}`);
        const settings = await this.pricing.settings(tx);
        const mode = this.pricing.effectiveMode(settings);

        if (product.kind !== 'LISTING') {
          const recent = await tx.booking.count({ where: { userId: user.id, kind: { not: 'LISTING' }, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } });
          if (recent >= settings.maxBookingsPerHour) {
            throw new HttpException('Zu viele Buchungen in kurzer Zeit. Bitte versuche es später noch einmal.', HttpStatus.TOO_MANY_REQUESTS);
          }
        }
        const listing = await tx.listing.findUniqueOrThrow({ where: { id: listingId } });
        const evaluation = await this.evaluate(tx, user, product, listing, now);
        if (!evaluation.available) throw new ConflictException(evaluation.reason);

        const price = this.pricing.quote(product, mode, now);
        const base = {
          userId: user.id,
          listingId,
          productId: product.id,
          kind: product.kind,
          priceCents: price.priceCents,
          currency: product.currency,
          billingMode: mode,
          snapshot: this.snapshot(product, mode, price.priceCents, now, price.reason),
          idempotencyKey: input.idempotencyKey,
        };
        if (price.requiresPayment) {
          const booking = await tx.booking.create({
            data: { ...base, status: 'PENDING_PAYMENT', payment: { create: { userId: user.id, amountCents: price.priceCents, currency: product.currency } } },
            include: bookingInclude,
          });
          return { booking, needsCheckout: true };
        }
        const endsAt = product.durationDays ? new Date(now.getTime() + product.durationDays * DAY_MS) : null;
        const created = await tx.booking.create({
          data: { ...base, status: product.kind === 'BUMP' ? 'COMPLETED' : 'ACTIVE', startsAt: now, endsAt },
          include: bookingInclude,
        });
        await this.applyEffect(tx, created, false, now);
        return { booking: created, needsCheckout: false };
      });
    } catch (error) {
      // Gleichzeitig doppelt abgeschickt: die erste Buchung gilt
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByKey(user.id, input.idempotencyKey);
        if (existing) return this.replay(existing, listingId, input.product);
      }
      throw error;
    }

    const { booking } = outcome;
    this.audit.log({
      action: 'billing.booking_created',
      actorId: user.id,
      entityType: 'booking',
      entityId: booking.id,
      ip,
      metadata: { product: booking.product.code, listingId, priceCents: booking.priceCents, billingMode: booking.billingMode },
    });
    if (!outcome.needsCheckout) {
      this.searchIndex.sync(listingId);
      return { booking: this.toDto(booking), checkoutUrl: null };
    }
    return { booking: this.toDto(booking), checkoutUrl: await this.startCheckout(user, booking) };
  }

  /** Nach der Rückkehr von Stripe: Zahlung bei Stripe abfragen (nicht dem Browser glauben) und ggf. aktivieren. */
  async confirm(user: AuthUser, bookingId: string): Promise<BookingDto> {
    const booking = await this.requireOwnBooking(user.id, bookingId);
    if (booking.status === 'PENDING_PAYMENT' && booking.payment?.checkoutSessionId) {
      try {
        const session = await this.stripe.retrieveCheckoutSession(booking.payment.checkoutSessionId);
        if (session.payment_status === 'paid') await this.activatePaid(bookingId, session);
      } catch (error) {
        if (!(error instanceof StripeUnavailableError)) throw error;
        this.logger.warn(`Zahlung ${bookingId} konnte nicht abgefragt werden: ${error.message}`);
      }
    }
    return this.toDto(await this.requireOwnBooking(user.id, bookingId));
  }

  /** Zahlung abgebrochen (Rückkehr über cancel_url) */
  async cancel(user: AuthUser, bookingId: string): Promise<BookingDto> {
    const booking = await this.requireOwnBooking(user.id, bookingId);
    if (booking.status === 'PENDING_PAYMENT') {
      if (booking.payment?.checkoutSessionId) {
        await this.stripe.expireCheckoutSession(booking.payment.checkoutSessionId).catch((error: Error) => {
          this.logger.warn(`Checkout ${booking.payment?.checkoutSessionId} nicht beendet: ${error.message}`);
        });
      }
      await this.closePending(bookingId, 'CANCELLED', 'CANCELLED', 'Zahlung abgebrochen');
      this.audit.log({ action: 'billing.booking_cancelled', actorId: user.id, entityType: 'booking', entityId: bookingId });
    }
    return this.toDto(await this.requireOwnBooking(user.id, bookingId));
  }

  // --- Zahlungen (Webhook bzw. Bestätigung) ----------------------------------------------------------

  /**
   * Aktiviert eine bezahlte Buchung genau einmal. Betrag, Währung, Buchung und Modus müssen zur gespeicherten
   * Zahlung passen – sonst wird nichts freigeschaltet.
   */
  async activatePaid(bookingId: string, session: CheckoutSession): Promise<'activated' | 'ignored' | 'rejected'> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `payment:${bookingId}`);
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
      if (!booking?.payment || booking.status !== 'PENDING_PAYMENT') return { outcome: 'ignored' as const, booking };
      const payment = booking.payment;
      const mismatch = this.paymentMismatch(payment, session, bookingId);
      if (mismatch) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: mismatch } });
        await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
        return { outcome: 'rejected' as const, booking, reason: mismatch };
      }
      const product = await tx.product.findUniqueOrThrow({ where: { id: booking.productId } });
      const durationDays = product.durationDays ?? (booking.snapshot as { durationDays?: number | null }).durationDays ?? null;
      let endsAt = durationDays ? new Date(now.getTime() + durationDays * DAY_MS) : null;
      if (booking.kind === 'LISTING' && booking.listingId && this.listingHandler) {
        endsAt = await this.listingHandler.activate(tx, booking.listingId, durationDays ?? (await this.pricing.listingDurationDays(tx)), now);
      }
      const activated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: booking.kind === 'BUMP' ? 'COMPLETED' : 'ACTIVE', startsAt: now, endsAt },
        include: bookingInclude,
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', paidAt: now, paymentIntentId: intentId(session) ?? undefined, livemode: session.livemode },
      });
      if (booking.kind !== 'LISTING') await this.applyEffect(tx, activated, true, now);
      return { outcome: 'activated' as const, booking: activated };
    });
    if (result.outcome === 'rejected') {
      this.audit.log({ action: 'billing.payment_failed', entityType: 'booking', entityId: bookingId, metadata: { reason: result.reason } });
    }
    if (result.outcome === 'activated') {
      this.audit.log({ action: 'billing.payment_succeeded', actorId: result.booking?.userId, entityType: 'booking', entityId: bookingId, metadata: { amountCents: result.booking?.priceCents ?? 0 } });
      if (result.booking?.listingId) this.searchIndex.sync(result.booking.listingId);
    }
    return result.outcome;
  }

  /** Session abgelaufen oder Zahlung fehlgeschlagen: Buchung ohne Wirkung schließen. */
  async failPending(bookingId: string, status: 'FAILED' | 'EXPIRED', reason: string) {
    const closed = await this.closePending(bookingId, 'CANCELLED', status, reason);
    if (closed) this.audit.log({ action: 'billing.payment_failed', entityType: 'booking', entityId: bookingId, metadata: { status, reason } });
  }

  /** Rückerstattung (Webhook charge.refunded): bei voller Erstattung endet die Leistung sofort. */
  async refund(paymentIntent: string, amountRefunded: number) {
    const payment = await this.prisma.payment.findUnique({ where: { paymentIntentId: paymentIntent }, include: { booking: true } });
    if (!payment) return 'ignored';
    const full = amountRefunded >= payment.amountCents;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedCents: Math.min(amountRefunded, payment.amountCents), refundedAt: now },
      });
      if (full && payment.booking.status !== 'REFUNDED') {
        await tx.booking.update({ where: { id: payment.bookingId }, data: { status: 'REFUNDED', endsAt: now } });
        await this.removeEffect(tx, payment.booking);
      }
    });
    this.audit.log({ action: 'billing.booking_refunded', entityType: 'booking', entityId: payment.bookingId, metadata: { amountRefunded, full } });
    if (payment.booking.listingId) this.searchIndex.sync(payment.booking.listingId);
    return 'processed';
  }

  // --- Ablauf ------------------------------------------------------------------------------------------

  /**
   * Regelmäßig (alle 5 Minuten): abgelaufene Buchungen schließen, Vorteile am Inserat entfernen, offene Zahlungen
   * verfallen lassen. Abfragen vergleichen ohnehin mit „jetzt“ – abgelaufene Leistungen wirken auch vor dem Lauf nicht.
   */
  async expire(now = new Date()) {
    const bookings = await this.prisma.booking.updateMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, data: { status: 'EXPIRED' } });
    // Rohes SQL: updatedAt des Inserats bleibt unverändert (Ablauf ist keine inhaltliche Änderung)
    const listings = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE listings SET
        highlighted_until = CASE WHEN highlighted_until <= ${now} THEN NULL ELSE highlighted_until END,
        highlight_paid = CASE WHEN highlighted_until <= ${now} THEN false ELSE highlight_paid END,
        top_until = CASE WHEN top_until <= ${now} THEN NULL ELSE top_until END,
        top_paid = CASE WHEN top_until <= ${now} THEN false ELSE top_paid END
      WHERE highlighted_until <= ${now} OR top_until <= ${now}
      RETURNING id`;
    for (const { id } of listings) this.searchIndex.sync(id);

    const stale = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(now.getTime() - PENDING_TIMEOUT_MS) } },
      select: { id: true },
    });
    for (const { id } of stale) await this.closePending(id, 'CANCELLED', 'EXPIRED', 'Zahlung nicht abgeschlossen');
    if (bookings.count || listings.length || stale.length) {
      this.audit.log({ action: 'billing.promotions_expired', metadata: { bookings: bookings.count, listings: listings.length, pending: stale.length } });
    }
    return { bookings: bookings.count, listings: listings.length, pending: stale.length };
  }

  // --- Abfragen ----------------------------------------------------------------------------------------

  /** Zusatzleistungen für ein eigenes Inserat: was geht, was läuft, wann wieder */
  async listingOptions(user: AuthUser, listingId: string): Promise<ListingPromotionOption[]> {
    const listing = await this.requireOwnedListing(user.id, listingId);
    const now = new Date();
    const [settings, products] = await Promise.all([this.pricing.settings(), this.pricing.products()]);
    const mode = this.pricing.effectiveMode(settings);
    const options: ListingPromotionOption[] = [];
    for (const product of products) {
      if (!(PROMOTION_CODES as readonly string[]).includes(product.code)) continue;
      const evaluation = await this.evaluate(this.prisma, user, product, listing, now);
      const price = this.pricing.quote(product, mode, now);
      options.push({
        code: product.code as ProductCode,
        kind: product.kind,
        name: product.name,
        description: product.description,
        priceCents: price.priceCents,
        requiresPayment: price.requiresPayment,
        durationDays: product.durationDays,
        available: evaluation.available,
        unavailableReason: evaluation.reason,
        activeUntil: evaluation.activeUntil?.toISOString() ?? null,
        nextAvailableAt: evaluation.nextAvailableAt?.toISOString() ?? null,
      });
    }
    return options;
  }

  async usage(userId: string, now = new Date()): Promise<ProductUsage[]> {
    const products = await this.pricing.products();
    return Promise.all(
      products
        .filter((p) => (PROMOTION_CODES as readonly string[]).includes(p.code))
        .map(async (product) => {
          const [active, usedInPeriod] = await Promise.all([
            this.countActive(this.prisma, product, now, userId),
            this.prisma.booking.count({
              where: { userId, productId: product.id, status: { in: [...COUNTED_STATUSES] }, createdAt: { gt: new Date(now.getTime() - product.periodDays * DAY_MS) } },
            }),
          ]);
          return {
            code: product.code as ProductCode,
            name: product.name,
            kind: product.kind,
            active,
            maxActivePerUser: product.maxActivePerUser,
            usedInPeriod,
            maxPerPeriod: product.maxPerPeriod,
            periodDays: product.periodDays,
            cooldownHours: product.cooldownHours,
          };
        }),
    );
  }

  async myOverview(user: AuthUser, page = 1): Promise<MyBillingOverview> {
    const now = new Date();
    const [settings, intro, usage, active, items, total] = await Promise.all([
      this.pricing.settings(),
      this.pricing.intro(now),
      this.usage(user.id, now),
      this.prisma.booking.findMany({
        where: { userId: user.id, kind: { not: 'LISTING' }, OR: [{ status: 'PENDING_PAYMENT' }, { status: 'ACTIVE', endsAt: { gt: now } }] },
        include: bookingInclude,
        orderBy: { endsAt: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: { userId: user.id },
        include: bookingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.booking.count({ where: { userId: user.id } }),
    ]);
    return {
      mode: this.pricing.effectiveMode(settings),
      intro,
      usage,
      activeBookings: active.map((b) => this.toDto(b)),
      history: { items: items.map((b) => this.toDto(b)), page, pageSize: PAGE_SIZE, total },
    };
  }

  async adminList(query: AdminBookingQuery): Promise<Paginated<AdminBookingDto>> {
    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.product ? { product: { code: query.product } } : {}),
      ...(query.price === 'paid' ? { priceCents: { gt: 0 } } : query.price === 'free' ? { priceCents: 0 } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: { ...bookingInclude, user: { select: { id: true, displayName: true, accountType: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ ...this.toDto(row), user: row.user })),
      page: query.page,
      pageSize: PAGE_SIZE,
      total,
    };
  }

  async adminCounts(now = new Date()) {
    const [activeBookings, bookings30d, paidBookings, revenue] = await Promise.all([
      this.prisma.booking.count({ where: { status: 'ACTIVE', endsAt: { gt: now }, kind: { not: 'LISTING' } } }),
      this.prisma.booking.count({ where: { createdAt: { gt: new Date(now.getTime() - 30 * DAY_MS) } } }),
      this.prisma.booking.count({ where: { priceCents: { gt: 0 } } }),
      this.prisma.payment.aggregate({ where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }, _sum: { amountCents: true, refundedCents: true } }),
    ]);
    return { activeBookings, bookings30d, paidBookings, revenueCents: (revenue._sum.amountCents ?? 0) - (revenue._sum.refundedCents ?? 0) };
  }

  toDto(booking: BookingWithRelations): BookingDto {
    return {
      id: booking.id,
      product: { code: booking.product.code, name: (booking.snapshot as { name?: string }).name ?? booking.product.name, kind: booking.product.kind },
      status: booking.status,
      priceCents: booking.priceCents,
      currency: booking.currency,
      billingMode: booking.billingMode,
      listing: booking.listing,
      startsAt: booking.startsAt?.toISOString() ?? null,
      endsAt: booking.endsAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      payment: booking.payment
        ? {
            status: booking.payment.status,
            amountCents: booking.payment.amountCents,
            refundedCents: booking.payment.refundedCents,
            paidAt: booking.payment.paidAt?.toISOString() ?? null,
            receiptUrl: booking.payment.receiptUrl,
          }
        : null,
    };
  }

  // --- intern --------------------------------------------------------------------------------------------

  /**
   * Prüft Berechtigung und Limits. Gibt einen deutschen Grund zurück statt zu werfen, damit dieselbe Prüfung
   * für die Anzeige („wieder möglich ab …“) und fürs Buchen gilt.
   */
  private async evaluate(db: Db, user: Pick<AuthUser, 'id' | 'accountType'>, product: Product, listing: ListingForBooking, now: Date): Promise<Evaluation> {
    const no = (reason: string, extra: Partial<Evaluation> = {}): Evaluation => ({ available: false, reason, activeUntil: null, nextAvailableAt: null, ...extra });
    if (!product.isActive) return no('Diese Leistung wird derzeit nicht angeboten.');
    if (!this.pricing.availableFor(product, user.accountType)) {
      return no(user.accountType === 'BUSINESS' ? 'Für gewerbliche Konten derzeit nicht verfügbar.' : 'Für private Konten derzeit nicht verfügbar.');
    }
    if (product.kind === 'LISTING') return { available: true, reason: null, activeUntil: null, nextAvailableAt: null };
    if (listing.deletedAt || effectiveStatus(listing, now) !== 'ACTIVE') return no('Nur für aktive Inserate möglich.');

    const activeUntil = product.kind === 'HIGHLIGHT' ? listing.highlightedUntil : product.kind === 'TOP_AD' ? listing.topUntil : null;
    if (activeUntil && activeUntil > now) return no(`Läuft bereits bis ${formatDateTime(activeUntil)}.`, { activeUntil });
    const pending = await db.booking.count({ where: { listingId: listing.id, productId: product.id, status: 'PENDING_PAYMENT' } });
    if (pending) return no('Für diese Leistung ist bereits eine Zahlung offen.');

    if (product.cooldownHours) {
      const base = Math.max(listing.publishedAt?.getTime() ?? 0, listing.bumpedAt?.getTime() ?? 0);
      const next = new Date(base + product.cooldownHours * HOUR_MS);
      if (next > now) return no(`Wieder möglich ab ${formatDateTime(next)}.`, { nextAvailableAt: next });
    }
    if (product.maxActivePerUser !== null && product.kind !== 'BUMP') {
      const active = await this.countActive(db, product, now, user.id);
      if (active >= product.maxActivePerUser) {
        return no(
          product.maxActivePerUser === 0
            ? 'Derzeit nicht buchbar.'
            : `Du hast bereits ${active} aktive ${product.name}${active === 1 ? '' : 'en'} – höchstens ${product.maxActivePerUser} gleichzeitig.`,
        );
      }
    }
    if (product.maxActiveTotal !== null && product.kind !== 'BUMP') {
      const total = await this.countActive(db, product, now);
      if (total >= product.maxActiveTotal) return no(`Alle Plätze für ${product.name}n sind gerade belegt. Bitte versuche es später noch einmal.`);
    }
    if (product.maxPerPeriod !== null) {
      const since = new Date(now.getTime() - product.periodDays * DAY_MS);
      const where = { userId: user.id, productId: product.id, status: { in: [...COUNTED_STATUSES] }, createdAt: { gt: since } };
      const used = await db.booking.count({ where });
      if (used >= product.maxPerPeriod) {
        const oldest = await db.booking.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
        const next = oldest ? new Date(oldest.createdAt.getTime() + product.periodDays * DAY_MS) : null;
        return no(
          `Limit erreicht: höchstens ${product.maxPerPeriod}-mal in ${product.periodDays} Tagen${next ? ` – wieder möglich ab ${formatDateTime(next)}` : ''}.`,
          { nextAvailableAt: next },
        );
      }
    }
    return { available: true, reason: null, activeUntil: null, nextAvailableAt: null };
  }

  /** Aktive Buchungen (bzw. offene Zahlungen) einer Leistung – je Konto oder insgesamt */
  private countActive(db: Db, product: Product, now: Date, userId?: string) {
    return db.booking.count({
      where: {
        productId: product.id,
        ...(userId ? { userId } : {}),
        OR: [{ status: 'ACTIVE', endsAt: { gt: now } }, { status: 'PENDING_PAYMENT' }],
      },
    });
  }

  /** Wirkung am Inserat (rohes SQL, damit updatedAt – Stand für die Moderation – unverändert bleibt) */
  private async applyEffect(tx: Tx, booking: Booking, paid: boolean, now: Date) {
    if (!booking.listingId) return;
    switch (booking.kind) {
      case 'HIGHLIGHT':
        await tx.$executeRaw`UPDATE listings SET highlighted_until = ${booking.endsAt}, highlight_paid = ${paid} WHERE id = ${booking.listingId}`;
        break;
      case 'TOP_AD':
        await tx.$executeRaw`UPDATE listings SET top_until = ${booking.endsAt}, top_paid = ${paid} WHERE id = ${booking.listingId}`;
        break;
      case 'BUMP':
        await tx.$executeRaw`UPDATE listings SET bumped_at = ${now} WHERE id = ${booking.listingId}`;
        break;
      case 'LISTING':
        break;
    }
  }

  private async removeEffect(tx: Tx, booking: Booking) {
    if (!booking.listingId) return;
    if (booking.kind === 'HIGHLIGHT') {
      await tx.$executeRaw`UPDATE listings SET highlighted_until = NULL, highlight_paid = false WHERE id = ${booking.listingId} AND highlighted_until = ${booking.endsAt}`;
    } else if (booking.kind === 'TOP_AD') {
      await tx.$executeRaw`UPDATE listings SET top_until = NULL, top_paid = false WHERE id = ${booking.listingId} AND top_until = ${booking.endsAt}`;
    }
  }

  private async startCheckout(user: AuthUser, booking: BookingWithRelations): Promise<string> {
    const web = loadEnv().WEB_URL;
    const back = `${web}/konto/leistungen/zahlung?buchung=${booking.id}`;
    try {
      const session = await this.stripe.createCheckoutSession({
        bookingId: booking.id,
        amountCents: booking.priceCents,
        currency: booking.currency,
        productName: `MarktAT – ${booking.product.name}`,
        description: booking.listing ? booking.listing.title.slice(0, 200) : undefined,
        customerEmail: user.email,
        successUrl: `${back}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${back}&abgebrochen=1`,
      });
      if (!session.url) throw new StripeUnavailableError('Stripe hat keine Checkout-Adresse geliefert.');
      await this.prisma.payment.update({ where: { bookingId: booking.id }, data: { checkoutSessionId: session.id, livemode: session.livemode } });
      return session.url;
    } catch (error) {
      await this.closePending(booking.id, 'CANCELLED', 'FAILED', 'Checkout konnte nicht gestartet werden');
      this.logger.warn(`Checkout für ${booking.id} fehlgeschlagen: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Die Zahlung konnte gerade nicht gestartet werden. Es wurde nichts verrechnet.');
    }
  }

  private async closePending(bookingId: string, bookingStatus: 'CANCELLED', paymentStatus: 'CANCELLED' | 'FAILED' | 'EXPIRED', reason: string) {
    const changed = await this.prisma.booking.updateMany({ where: { id: bookingId, status: 'PENDING_PAYMENT' }, data: { status: bookingStatus } });
    if (changed.count) {
      await this.prisma.payment.updateMany({ where: { bookingId, status: 'PENDING' }, data: { status: paymentStatus, failureReason: reason } });
    }
    return changed.count > 0;
  }

  private paymentMismatch(payment: Payment, session: CheckoutSession, bookingId: string): string | null {
    if (session.payment_status !== 'paid') return 'Zahlung nicht abgeschlossen';
    if (payment.checkoutSessionId && session.id !== payment.checkoutSessionId) return 'Checkout-Session passt nicht zur Buchung';
    if (session.client_reference_id !== bookingId && session.metadata?.bookingId !== bookingId) return 'Buchung passt nicht zur Zahlung';
    if (session.amount_total !== payment.amountCents) return 'Betrag weicht ab';
    if ((session.currency ?? '').toUpperCase() !== payment.currency.toUpperCase()) return 'Währung weicht ab';
    if (session.livemode !== (this.stripe.status.keyMode === 'live')) return 'Stripe-Modus passt nicht';
    if (session.livemode && !this.stripe.status.liveEnabled) return 'Live-Zahlungen sind gesperrt';
    return null;
  }

  private snapshot(product: Product, mode: BillingMode, priceCents: number, at: Date, reason?: string): Prisma.InputJsonValue {
    return {
      code: product.code,
      name: product.name,
      kind: product.kind,
      durationDays: product.durationDays,
      listPriceCents: product.priceCents,
      plannedPriceCents: product.plannedPriceCents,
      paidEnabled: product.paidEnabled,
      promotion: Boolean(product.promoStartsAt || product.promoEndsAt),
      chargedCents: priceCents,
      billingMode: mode,
      ...(reason ? { priceReason: reason } : {}),
      at: at.toISOString(),
    };
  }

  private async lock(tx: Tx, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private findByKey(userId: string, idempotencyKey: string) {
    return this.prisma.booking.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: bookingInclude });
  }

  /** Wiederholte Anfrage mit demselben Schlüssel: bestehende Buchung zurückgeben (nie eine zweite anlegen). */
  private async replay(existing: BookingWithRelations, listingId: string, product: string): Promise<BookingResult> {
    if (existing.listingId !== listingId || existing.product.code !== product) {
      throw new ConflictException('Diese Anfrage wurde bereits für eine andere Buchung verwendet.');
    }
    let checkoutUrl: string | null = null;
    if (existing.status === 'PENDING_PAYMENT' && existing.payment?.checkoutSessionId) {
      const session = await this.stripe.retrieveCheckoutSession(existing.payment.checkoutSessionId).catch(() => null);
      checkoutUrl = session?.status === 'open' ? session.url : null;
    }
    return { booking: this.toDto(existing), checkoutUrl };
  }

  private async requireOwnedListing(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status === 'DELETED' || listing.sellerId !== userId) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    return listing;
  }

  private async requireOwnBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
    if (!booking || booking.userId !== userId) throw new NotFoundException('Diese Buchung gibt es nicht.');
    return booking;
  }
}

function intentId(session: CheckoutSession) {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id;
}
