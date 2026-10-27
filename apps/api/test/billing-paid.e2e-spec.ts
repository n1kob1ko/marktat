import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { StripeStatus } from '@marktat/shared';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { resetEnvCache } from '../src/config/env.js';
import {
  signStripePayload,
  StripeUnavailableError,
  type CheckoutSession,
  type CheckoutSessionRequest,
  type StripeGateway,
} from '../src/billing/stripe.gateway.js';
import { createTestApp, publishListing, resetData, signIn, signInAs } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const WEBHOOK_SECRET = 'whsec_test_e2e_only';
const key = () => randomBytes(16).toString('hex');
const DAY_MS = 86_400_000;

/**
 * Testdouble für Stripe (Testmodus): merkt sich Checkout-Sessions wie die echte API. Echte Aufrufe gegen den
 * Stripe-Testmodus brauchen Zugangsdaten und sind in docs/monetarisierung.md als offen vermerkt.
 */
class FakeStripe implements StripeGateway {
  status: StripeStatus = { configured: true, keyMode: 'test', webhookConfigured: true, liveEnabled: false, usable: true };
  readonly sessions = new Map<string, CheckoutSession>();
  readonly requests: CheckoutSessionRequest[] = [];
  readonly expired: string[] = [];
  failNext = false;

  async createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSession> {
    if (this.failNext) {
      this.failNext = false;
      throw new StripeUnavailableError('Stripe-Fehler 500: Testausfall');
    }
    this.requests.push(input);
    const id = `cs_test_${randomBytes(8).toString('hex')}`;
    const session: CheckoutSession = {
      id,
      url: `https://checkout.stripe.test/c/pay/${id}`,
      livemode: false,
      status: 'open',
      payment_status: 'unpaid',
      amount_total: input.amountCents,
      currency: input.currency.toLowerCase(),
      client_reference_id: input.bookingId,
      metadata: { bookingId: input.bookingId },
      payment_intent: null,
    };
    this.sessions.set(id, session);
    return { ...session };
  }

  async retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
    const session = this.sessions.get(id);
    if (!session) throw new StripeUnavailableError('Stripe-Fehler 404: unbekannte Session');
    return { ...session };
  }

  async expireCheckoutSession(id: string): Promise<void> {
    this.expired.push(id);
    const session = this.sessions.get(id);
    if (session) session.status = 'expired';
  }

  /** Simuliert die erfolgreiche Zahlung im Checkout */
  pay(id: string): CheckoutSession {
    const session = this.sessions.get(id)!;
    Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: `pi_test_${randomBytes(8).toString('hex')}` });
    return { ...session };
  }
}

/** Kostenpflichtiger Betrieb gegen ein Stripe-Testdouble: Checkout, Webhooks, Rückerstattung, Missbrauch. */
describe('Monetarisierung im kostenpflichtigen Betrieb (Stripe-Testdouble)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const stripe = new FakeStripe();
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    resetEnvCache();
    ({ app, prisma } = await createTestApp({ stripe }));
  });
  beforeEach(async () => {
    await resetData(prisma);
    stripe.status = { configured: true, keyMode: 'test', webhookConfigured: true, liveEnabled: false, usable: true };
    stripe.sessions.clear();
    stripe.requests.length = 0;
    stripe.expired.length = 0;
  });
  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    resetEnvCache();
  });

  const server = () => app.getHttpServer();
  const book = (account: Account, listingId: string, product: string, idempotencyKey = key()) =>
    request(server()).post(`/v1/listings/${listingId}/bookings`).set(account.auth).send({ product, idempotencyKey });

  const sendEvent = (event: Record<string, unknown>, signature?: string) => {
    const payload = JSON.stringify(event);
    return request(server())
      .post('/v1/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature ?? signStripePayload(payload, WEBHOOK_SECRET))
      .send(payload);
  };
  const event = (type: string, object: unknown, livemode = false) => ({ id: `evt_${randomBytes(10).toString('hex')}`, type, livemode, data: { object } });

  /** Admin schaltet ausdrücklich um und gibt eine Leistung mit Preis frei */
  async function enablePaid(code: string, priceCents: number) {
    const admin = await signInAs(app, 'ADMIN');
    await request(server()).put('/v1/admin/billing/mode').set(admin.auth).send({ mode: 'PAID', confirmation: 'KOSTENPFLICHTIG' }).expect(200);
    await prisma.product.update({ where: { code }, data: { priceCents, paidEnabled: true } });
    return admin;
  }

  async function pendingHighlight() {
    await enablePaid('highlight', 490);
    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const res = await book(seller, listing.id, 'highlight').expect(201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: res.body.booking.id } });
    return { seller, listing, booking: res.body.booking, checkoutUrl: res.body.checkoutUrl as string, sessionId: payment.checkoutSessionId! };
  }

  it('schaltet erst nach Bestätigung um und verlangt dann den Preis über Stripe Checkout – noch ohne Wirkung', async () => {
    // Nur Produktpreis ohne Moduswechsel: weiterhin kostenlos
    await prisma.product.update({ where: { code: 'highlight' }, data: { priceCents: 490, paidEnabled: true } });
    expect((await request(server()).get('/v1/billing').expect(200)).body.products[1]).toMatchObject({ code: 'highlight', priceCents: 0, requiresPayment: false });

    const { booking, checkoutUrl, listing } = await pendingHighlight();
    expect(booking).toMatchObject({ status: 'PENDING_PAYMENT', priceCents: 490, billingMode: 'PAID' });
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(stripe.requests[0]).toMatchObject({ bookingId: booking.id, amountCents: 490, currency: 'EUR' });
    expect(stripe.requests[0]!.successUrl).toContain(`/konto/leistungen/zahlung?buchung=${booking.id}&session_id={CHECKOUT_SESSION_ID}`);
    const detail = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(detail.body).toMatchObject({ highlighted: false, sponsored: false });
    // Einführungsaktion verschwindet, sobald Inserieren etwas kosten könnte, ist aber nicht betroffen (Inserat weiter 0 €)
    expect((await request(server()).get('/v1/billing').expect(200)).body.mode).toBe('PAID');
  });

  it('aktiviert nur über einen signierten Webhook mit passendem Betrag – genau einmal', async () => {
    const { booking, sessionId, listing } = await pendingHighlight();
    const paid = stripe.pay(sessionId);

    // Ohne bzw. mit falscher Signatur: nichts passiert
    await sendEvent(event('checkout.session.completed', paid), 't=1,v1=00').expect(400);
    const forged = JSON.stringify(event('checkout.session.completed', paid));
    await sendEvent(JSON.parse(forged), signStripePayload(forged, 'whsec_falsch')).expect(400);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING_PAYMENT');

    const completed = event('checkout.session.completed', paid);
    expect((await sendEvent(completed).expect(200)).body).toEqual({ received: true, result: 'processed' });
    expect((await sendEvent(completed).expect(200)).body).toEqual({ received: true, result: 'duplicate' });
    // Gleiche Zahlung als neues Ereignis: bereits aktiv, keine zweite Freischaltung
    expect((await sendEvent(event('checkout.session.async_payment_succeeded', paid)).expect(200)).body.result).toBe('ignored');

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } });
    expect(stored).toMatchObject({ status: 'ACTIVE', payment: { status: 'SUCCEEDED', amountCents: 490, paymentIntentId: paid.payment_intent, livemode: false } });
    expect(stored.endsAt!.getTime() - stored.startsAt!.getTime()).toBe(7 * DAY_MS);
    const detail = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(detail.body).toMatchObject({ highlighted: true, sponsored: true });
    expect(await prisma.auditLog.count({ where: { action: 'billing.payment_succeeded', entityId: booking.id } })).toBe(1);
  });

  it('lehnt abweichende Beträge, fremde Sessions und Live-Ereignisse ab', async () => {
    const { booking, sessionId } = await pendingHighlight();
    const paid = stripe.pay(sessionId);

    expect((await sendEvent(event('checkout.session.completed', paid, true)).expect(200)).body.result).toBe('rejected');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING_PAYMENT');

    const cheap = { ...paid, amount_total: 1 };
    expect((await sendEvent(event('checkout.session.completed', cheap)).expect(200)).body.result).toBe('rejected');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } });
    expect(stored).toMatchObject({ status: 'CANCELLED', payment: { status: 'FAILED', failureReason: 'Betrag weicht ab' } });
    // Später korrekter Betrag: die abgelehnte Buchung bleibt ohne Wirkung
    expect((await sendEvent(event('checkout.session.completed', paid)).expect(200)).body.result).toBe('ignored');
    expect((await prisma.listing.findFirstOrThrow({ where: { id: stored.listingId! } })).highlightedUntil).toBeNull();

    const second = await pendingHighlight();
    const other = { ...stripe.pay(second.sessionId), id: 'cs_test_fremd' };
    expect((await sendEvent(event('checkout.session.completed', other)).expect(200)).body.result).toBe('rejected');
    expect(await prisma.auditLog.count({ where: { action: 'billing.webhook_rejected' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'billing.payment_failed' } })).toBe(2);
  });

  it('bestätigt nach der Rückkehr per Abfrage bei Stripe und lässt sich vorher abbrechen', async () => {
    const first = await pendingHighlight();
    // Noch nicht bezahlt: bleibt offen
    expect((await request(server()).post(`/v1/bookings/${first.booking.id}/confirm`).set(first.seller.auth).expect(200)).body.status).toBe('PENDING_PAYMENT');
    stripe.pay(first.sessionId);
    const stranger = await signIn(app);
    await request(server()).post(`/v1/bookings/${first.booking.id}/confirm`).set(stranger.auth).expect(404);
    expect((await request(server()).post(`/v1/bookings/${first.booking.id}/confirm`).set(first.seller.auth).expect(200)).body.status).toBe('ACTIVE');

    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const pending = await book(seller, listing.id, 'top').expect(201);
    expect(pending.body.booking.status).toBe('ACTIVE'); // Top ist nicht freigegeben: weiterhin kostenlos
    await prisma.product.update({ where: { code: 'bump' }, data: { priceCents: 99, paidEnabled: true, cooldownHours: 0 } });
    const bump = await book(seller, listing.id, 'bump').expect(201);
    expect(bump.body.booking.status).toBe('PENDING_PAYMENT');
    const cancelled = await request(server()).post(`/v1/bookings/${bump.body.booking.id}/cancel`).set(seller.auth).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(stripe.expired).toHaveLength(1);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).bumpedAt).toBeNull();
  });

  it('beendet die Leistung bei voller Rückerstattung und verfällt offene Zahlungen', async () => {
    const { booking, sessionId, listing } = await pendingHighlight();
    const paid = stripe.pay(sessionId);
    await sendEvent(event('checkout.session.completed', paid)).expect(200);

    const partial = await sendEvent(event('charge.refunded', { payment_intent: paid.payment_intent, amount_refunded: 100 })).expect(200);
    expect(partial.body.result).toBe('processed');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } })).payment).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 100 });

    await sendEvent(event('charge.refunded', { payment_intent: paid.payment_intent, amount_refunded: 490 })).expect(200);
    const refunded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } });
    expect(refunded).toMatchObject({ status: 'REFUNDED', payment: { status: 'REFUNDED', refundedCents: 490 } });
    const detail = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(detail.body).toMatchObject({ highlighted: false, sponsored: false });

    // Abgelaufener Checkout (Webhook) schließt die Buchung ohne Wirkung
    const seller = await signIn(app);
    const other = await publishListing(app, seller.auth);
    const open = await book(seller, other.id, 'highlight').expect(201);
    const session = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: open.body.booking.id } })).checkoutSessionId!;
    await sendEvent(event('checkout.session.expired', { ...stripe.sessions.get(session), status: 'expired' })).expect(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: open.body.booking.id }, include: { payment: true } })).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'EXPIRED' },
    });
  });

  it('veröffentlicht Inserate nur nach Zahlung, wenn das Inserieren freigegeben etwas kostet', async () => {
    await enablePaid('listing', 290);
    const seller = await signIn(app);
    const draft = await publishListing(app, seller.auth, { publish: false });
    const denied = await request(server()).post(`/v1/listings/${draft.id}/publish`).set(seller.auth).expect(402);
    expect(denied.body.message).toContain('Das Veröffentlichen kostet derzeit');

    const res = await book(seller, draft.id, 'listing').expect(201);
    expect(res.body.booking).toMatchObject({ status: 'PENDING_PAYMENT', priceCents: 290 });
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    const session = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: res.body.booking.id } })).checkoutSessionId!;
    await sendEvent(event('checkout.session.completed', stripe.pay(session))).expect(200);
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: draft.id } });
    expect(listing.status).toBe('ACTIVE');
    expect(listing.expiresAt!.getTime() - listing.publishedAt!.getTime()).toBe(60 * DAY_MS);
  });

  it('fällt ohne nutzbares Stripe auf kostenlos zurück und meldet Ausfälle, ohne etwas zu verrechnen', async () => {
    await enablePaid('highlight', 490);
    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);

    stripe.failNext = true;
    const failed = await book(seller, listing.id, 'highlight').expect(503);
    expect(failed.body.message).toContain('Es wurde nichts verrechnet');
    expect(await prisma.booking.findFirstOrThrow({ where: { kind: 'HIGHLIGHT' }, include: { payment: true } })).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'FAILED' },
    });

    // Stripe-Konfiguration fällt weg: es gilt wieder der kostenlose Betrieb
    stripe.status = { ...stripe.status, usable: false, keyMode: null, configured: false };
    expect((await request(server()).get('/v1/billing').expect(200)).body.mode).toBe('FREE');
    const free = await book(seller, listing.id, 'highlight').expect(201);
    expect(free.body.booking).toMatchObject({ status: 'ACTIVE', priceCents: 0, billingMode: 'FREE' });
  });

  it('sperrt Live-Schlüssel ohne Freigabe', async () => {
    stripe.status = { configured: true, keyMode: 'live', webhookConfigured: true, liveEnabled: false, usable: false };
    const admin = await signInAs(app, 'ADMIN');
    const blocked = await request(server()).put('/v1/admin/billing/mode').set(admin.auth).send({ mode: 'PAID', confirmation: 'KOSTENPFLICHTIG' }).expect(409);
    expect(JSON.stringify(blocked.body)).toContain('STRIPE_LIVE_ENABLED');
    expect((await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } })).billingMode).toBe('FREE');
  });
});
