import { redact } from './jobs.service.js';

describe('redact', () => {
  it('entfernt E-Mail-Adressen aus Fehlermeldungen und kürzt sie', () => {
    expect(redact('550 <anna.huber@example.at>: Recipient address rejected')).toBe('550 <[E-Mail]>: Recipient address rejected');
    expect(redact('x'.repeat(400))).toHaveLength(300);
  });
});
