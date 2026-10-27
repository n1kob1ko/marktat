import { Inject, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import {
  DEFAULT_LISTING_DURATION_DAYS,
  effectivePrice,
  introOffer,
  type AccountType,
  type BillingMode,
  type BillingSettingsDto,
  type EffectivePrice,
  type IntroOffer,
  type ProductCode,
  type ProductDto,
  type PublicBillingInfo,
} from '@marktat/shared';
import type { PlatformSettings, Prisma, Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway.js';
import { loadEnv } from '../config/env.js';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Startkonfiguration (identisch mit der Migration 20261028090000_monetization): alles kostenlos.
 * Die Limits sind Entwicklungsstandards gegen Missbrauch, keine endgültigen Geschäftsregeln.
 */
export const DEFAULT_PRODUCTS = [
  {
    id: 'prod_listing',
    code: 'listing',
    kind: 'LISTING',
    name: 'Inserat',
    description: 'Ein Inserat veröffentlichen oder verlängern.',
    durationDays: DEFAULT_LISTING_DURATION_DAYS,
    maxActivePerUser: null,
    maxActiveTotal: null,
    maxPerPeriod: null,
    cooldownHours: null,
    sortOrder: 0,
  },
  {
    id: 'prod_highlight',
    code: 'highlight',
    kind: 'HIGHLIGHT',
    name: 'Hervorhebung',
    description: 'Dein Inserat fällt in Suchergebnissen und Listen durch eine farbige Markierung auf.',
    durationDays: 7,
    maxActivePerUser: 5,
    maxActiveTotal: null,
    maxPerPeriod: 10,
    cooldownHours: null,
    sortOrder: 1,
  },
  {
    id: 'prod_top',
    code: 'top',
    kind: 'TOP_AD',
    name: 'Top-Anzeige',
    description: 'Dein Inserat erscheint abwechselnd mit anderen im Bereich „Top-Anzeigen“ über passenden Suchergebnissen.',
    durationDays: 7,
    maxActivePerUser: 2,
    maxActiveTotal: 200,
    maxPerPeriod: 4,
    cooldownHours: null,
    sortOrder: 2,
  },
  {
    id: 'prod_bump',
    code: 'bump',
    kind: 'BUMP',
    name: 'Hochschieben',
    description: 'Dein Inserat rückt in der Sortierung „Neueste“ wieder nach oben. Das Veröffentlichungsdatum bleibt gleich.',
    durationDays: null,
    maxActivePerUser: null,
    maxActiveTotal: null,
    maxPerPeriod: 30,
    cooldownHours: 24,
    sortOrder: 3,
  },
] as const satisfies readonly (Omit<Prisma.ProductCreateManyInput, 'updatedAt'> & { code: ProductCode })[];

/** Preise, Leistungen und Betriebsmodus. Jede Preisberechnung läuft hier – nie im Browser. */
@Injectable()
export class PricingService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureDefaults();
  }

  /** Legt fehlende Einstellungen und Leistungen an; bestehende werden nie überschrieben. */
  async ensureDefaults() {
    await this.prisma.platformSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await this.prisma.product.createMany({ data: DEFAULT_PRODUCTS.map((p) => ({ ...p })), skipDuplicates: true });
  }

  async settings(db: Db = this.prisma): Promise<PlatformSettings> {
    return (await db.platformSettings.findUnique({ where: { id: 1 } })) ?? db.platformSettings.create({ data: { id: 1 } });
  }

  /**
   * Betriebsmodus, der tatsächlich gilt. PAID wirkt nur, solange Stripe nutzbar ist – fällt die Konfiguration weg,
   * wird nichts verrechnet (lieber kostenlos als eine Zahlung, die nicht abgewickelt werden kann).
   */
  effectiveMode(settings: PlatformSettings): BillingMode {
    return settings.billingMode === 'PAID' && this.paidModeBlockers().length === 0 ? 'PAID' : 'FREE';
  }

  /** Gründe, die gegen den kostenpflichtigen Betrieb sprechen (leer = möglich). */
  paidModeBlockers(): string[] {
    const status = this.stripe.status;
    const blockers: string[] = [];
    if (!status.keyMode) blockers.push('STRIPE_SECRET_KEY fehlt oder ist kein Stripe-Schlüssel.');
    if (!status.webhookConfigured) blockers.push('STRIPE_WEBHOOK_SECRET fehlt – Zahlungen könnten nicht bestätigt werden.');
    if (status.keyMode === 'live' && !status.liveEnabled) blockers.push('Live-Schlüssel ist gesperrt (STRIPE_LIVE_ENABLED ist nicht gesetzt).');
    // In Produktion keine Testzahlungen: dort braucht es den freigegebenen Live-Modus
    if (loadEnv().NODE_ENV === 'production' && status.keyMode !== 'live') {
      blockers.push('In Produktion ist der kostenpflichtige Betrieb nur mit freigegebenem Stripe-Live-Modus möglich.');
    }
    return blockers;
  }

  products(db: Db = this.prisma) {
    return db.product.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  async product(code: string, db: Db = this.prisma): Promise<Product> {
    const product = await db.product.findUnique({ where: { code } });
    if (!product) throw new NotFoundException('Diese Leistung gibt es nicht.');
    return product;
  }

  quote(product: Product, mode: BillingMode, now = new Date()): EffectivePrice {
    return effectivePrice(product, mode, now);
  }

  availableFor(product: Product, accountType: AccountType) {
    return accountType === 'BUSINESS' ? product.forBusiness : product.forPrivate;
  }

  /** Laufzeit eines Inserats (Produkt „listing“) */
  async listingDurationDays(db: Db = this.prisma) {
    const product = await db.product.findUnique({ where: { code: 'listing' }, select: { durationDays: true } });
    return product?.durationDays ?? DEFAULT_LISTING_DURATION_DAYS;
  }

  async intro(now = new Date()): Promise<IntroOffer | null> {
    const [settings, listing] = await Promise.all([this.settings(), this.prisma.product.findUnique({ where: { code: 'listing' } })]);
    return introOffer(settings, listing, this.effectiveMode(settings), now);
  }

  async publicInfo(now = new Date()): Promise<PublicBillingInfo> {
    const [settings, products] = await Promise.all([this.settings(), this.products()]);
    const mode = this.effectiveMode(settings);
    const listing = products.find((p) => p.code === 'listing') ?? null;
    return {
      mode,
      intro: introOffer(settings, listing, mode, now),
      products: products.map((p) => {
        const price = effectivePrice(p, mode, now);
        return {
          code: p.code as ProductCode,
          kind: p.kind,
          name: p.name,
          description: p.description,
          priceCents: price.priceCents,
          requiresPayment: price.requiresPayment,
          plannedPriceCents: p.plannedPriceCents,
          durationDays: p.durationDays,
          isActive: p.isActive,
        };
      }),
    };
  }

  toProductDto(product: Product, mode: BillingMode, now = new Date()): ProductDto {
    return {
      id: product.id,
      code: product.code as ProductCode,
      kind: product.kind,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      plannedPriceCents: product.plannedPriceCents,
      currency: 'EUR',
      durationDays: product.durationDays,
      forPrivate: product.forPrivate,
      forBusiness: product.forBusiness,
      isActive: product.isActive,
      paidEnabled: product.paidEnabled,
      promoStartsAt: product.promoStartsAt?.toISOString() ?? null,
      promoEndsAt: product.promoEndsAt?.toISOString() ?? null,
      maxActivePerUser: product.maxActivePerUser,
      maxActiveTotal: product.maxActiveTotal,
      maxPerPeriod: product.maxPerPeriod,
      periodDays: product.periodDays,
      cooldownHours: product.cooldownHours,
      sortOrder: product.sortOrder,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      effective: effectivePrice(product, mode, now),
    };
  }

  toSettingsDto(settings: PlatformSettings): BillingSettingsDto {
    return {
      billingMode: settings.billingMode,
      billingModeChangedAt: settings.billingModeChangedAt?.toISOString() ?? null,
      introEnabled: settings.introEnabled,
      introVisible: settings.introVisible,
      introTitle: settings.introTitle,
      introDescription: settings.introDescription,
      introStartsAt: settings.introStartsAt?.toISOString() ?? null,
      introEndsAt: settings.introEndsAt?.toISOString() ?? null,
      introShowPlannedPrice: settings.introShowPlannedPrice,
      maxBookingsPerHour: settings.maxBookingsPerHour,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}
