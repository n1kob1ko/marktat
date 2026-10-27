import { formEncode, InvalidSignatureError, signStripePayload, stripeStatus, verifyStripeSignature } from './stripe.gateway.js';

const SECRET = 'whsec_unit';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const ts = Math.floor(NOW / 1000);
const payload = '{"id":"evt_1","type":"checkout.session.completed"}';

describe('verifyStripeSignature', () => {
  it('akzeptiert eine korrekte Signatur, auch neben einer veralteten v1', () => {
    const header = signStripePayload(payload, SECRET, ts);
    expect(() => verifyStripeSignature(Buffer.from(payload), header, SECRET, 300, NOW)).not.toThrow();
    expect(() => verifyStripeSignature(Buffer.from(payload), `${header},v1=${'0'.repeat(64)}`, SECRET, 300, NOW)).not.toThrow();
  });

  it('lehnt fehlende, unvollständige, falsche und veränderte Signaturen ab', () => {
    const header = signStripePayload(payload, SECRET, ts);
    for (const bad of [undefined, '', `t=${ts}`, 'v1=abc', signStripePayload(payload, 'whsec_anders', ts)]) {
      expect(() => verifyStripeSignature(Buffer.from(payload), bad, SECRET, 300, NOW)).toThrow(InvalidSignatureError);
    }
    expect(() => verifyStripeSignature(Buffer.from(payload.replace('evt_1', 'evt_2')), header, SECRET, 300, NOW)).toThrow('Signatur ungültig.');
  });

  it('lehnt alte (wieder eingespielte) Ereignisse ab', () => {
    const header = signStripePayload(payload, SECRET, ts - 301);
    expect(() => verifyStripeSignature(Buffer.from(payload), header, SECRET, 300, NOW)).toThrow('Signatur abgelaufen.');
  });
});

describe('stripeStatus', () => {
  const env = { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_LIVE_ENABLED: false } as const;

  it('ist ohne Schlüssel nicht nutzbar – der kostenlose Betrieb braucht nichts', () => {
    expect(stripeStatus(env)).toEqual({ configured: false, keyMode: null, webhookConfigured: false, liveEnabled: false, usable: false });
  });

  it('nutzt Testschlüssel nur mit Webhook-Secret', () => {
    expect(stripeStatus({ ...env, STRIPE_SECRET_KEY: 'sk_test_x' }).usable).toBe(false);
    expect(stripeStatus({ ...env, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toMatchObject({ keyMode: 'test', usable: true });
  });

  it('sperrt Live-Schlüssel ohne ausdrückliche Freigabe', () => {
    const live = { ...env, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
    expect(stripeStatus(live)).toMatchObject({ keyMode: 'live', usable: false });
    expect(stripeStatus({ ...live, STRIPE_LIVE_ENABLED: true }).usable).toBe(true);
    expect(stripeStatus({ ...env, STRIPE_SECRET_KEY: 'pk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).keyMode).toBeNull();
  });
});

describe('formEncode', () => {
  it('kodiert verschachtelte Felder wie Stripe und lässt leere weg', () => {
    expect(formEncode({ mode: 'payment', skip: undefined, line_items: { 0: { price_data: { unit_amount: 490, product_data: { name: 'Top & mehr' } } } } })).toEqual([
      'mode=payment',
      `${encodeURIComponent('line_items[0][price_data][unit_amount]')}=490`,
      `${encodeURIComponent('line_items[0][price_data][product_data][name]')}=Top%20%26%20mehr`,
    ]);
  });
});
