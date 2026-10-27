import { createHmac, timingSafeEqual } from 'node:crypto';
import type { StripeStatus } from '@marktat/shared';
import type { Env } from '../config/env.js';

/**
 * Schlanke Anbindung an die Stripe-API über fetch (wie bei Meilisearch ohne SDK). Unterstützt genau das, was
 * die Buchungen brauchen: Checkout-Session anlegen, abrufen und abbrechen sowie Webhook-Signaturen prüfen.
 */
export interface CheckoutSessionRequest {
  bookingId: string;
  amountCents: number;
  currency: string;
  productName: string;
  description?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

/** Die Felder einer Checkout-Session, die wir auswerten */
export interface CheckoutSession {
  id: string;
  url: string | null;
  livemode: boolean;
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
  payment_intent: string | { id: string } | null;
}

export interface StripeGateway {
  readonly status: StripeStatus;
  createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<CheckoutSession>;
  expireCheckoutSession(id: string): Promise<void>;
}

export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

export class StripeUnavailableError extends Error {}

/** Welche Art von Schlüssel ist gesetzt? Live-Schlüssel bleiben ohne Freigabe unbenutzbar. */
export function stripeStatus(env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_LIVE_ENABLED'>): StripeStatus {
  const key = env.STRIPE_SECRET_KEY;
  const keyMode = !key ? null : /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null;
  const webhookConfigured = Boolean(env.STRIPE_WEBHOOK_SECRET);
  const keyUsable = keyMode === 'test' || (keyMode === 'live' && env.STRIPE_LIVE_ENABLED);
  return {
    configured: keyMode !== null && webhookConfigured,
    keyMode,
    webhookConfigured,
    liveEnabled: env.STRIPE_LIVE_ENABLED,
    usable: keyUsable && webhookConfigured,
  };
}

/** Formularkodierung wie von Stripe erwartet: verschachtelte Schlüssel als a[b][c]=… */
export function formEncode(value: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined || inner === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof inner === 'object') parts.push(...formEncode(inner as Record<string, unknown>, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(inner))}`);
  }
  return parts;
}

export class HttpStripeGateway implements StripeGateway {
  readonly status: StripeStatus;

  constructor(private readonly env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_LIVE_ENABLED' | 'STRIPE_API_URL'>) {
    this.status = stripeStatus(env);
  }

  async createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSession> {
    const body = formEncode({
      mode: 'payment',
      client_reference_id: input.bookingId,
      customer_email: input.customerEmail,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Kürzeste von Stripe erlaubte Gültigkeit; danach verfällt die Buchung
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { bookingId: input.bookingId },
      payment_intent_data: { metadata: { bookingId: input.bookingId } },
      line_items: {
        0: {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name: input.productName, description: input.description },
          },
        },
      },
    }).join('&');
    // Gleiche Buchung = gleiche Session, auch wenn die Anfrage wiederholt wird
    return this.request<CheckoutSession>('POST', '/v1/checkout/sessions', body, `checkout-${input.bookingId}`);
  }

  retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
    return this.request<CheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
  }

  async expireCheckoutSession(id: string): Promise<void> {
    await this.request('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, '');
  }

  private async request<T>(method: string, path: string, body?: string, idempotencyKey?: string): Promise<T> {
    if (!this.status.usable) throw new StripeUnavailableError('Stripe ist nicht (freigegeben) konfiguriert.');
    let response: Response;
    try {
      response = await fetch(`${this.env.STRIPE_API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`,
          ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: method === 'GET' ? undefined : body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new StripeUnavailableError(`Stripe nicht erreichbar: ${(error as Error).message}`);
    }
    const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !data) {
      // Fehlermeldung ohne Schlüssel oder Kundendaten weitergeben
      throw new StripeUnavailableError(`Stripe-Fehler ${response.status}: ${data?.error?.message?.slice(0, 200) ?? 'unbekannt'}`);
    }
    return data;
  }
}

export class InvalidSignatureError extends Error {}

/**
 * Prüft die Signatur eines Webhooks (Header `Stripe-Signature: t=…,v1=…`) wie das offizielle SDK:
 * HMAC-SHA256 über „t.Rohdaten“ mit dem Webhook-Secret, Vergleich in konstanter Zeit, höchstens
 * `toleranceSeconds` alt (Schutz vor wiederholt eingespielten Ereignissen).
 */
export function verifyStripeSignature(payload: Buffer, header: string | undefined, secret: string, toleranceSeconds = 300, now = Date.now()) {
  if (!header) throw new InvalidSignatureError('Signatur fehlt.');
  const items = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(items.find(([key]) => key === 't')?.[1]);
  const signatures = items.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  if (!Number.isFinite(timestamp) || !signatures.length) throw new InvalidSignatureError('Signatur unvollständig.');
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) throw new InvalidSignatureError('Signatur abgelaufen.');
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  const valid = signatures.some((signature) => {
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new InvalidSignatureError('Signatur ungültig.');
}

/** Für Tests und Testdoubles: Header so erzeugen, wie Stripe ihn senden würde. */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
