import { ImageUrls } from './image-urls.js';

const urls = new ImageUrls('https://api.example.at', 'test-secret-test-secret-test-secret!!');
const now = Date.parse('2026-10-27T10:15:00Z');

describe('ImageUrls', () => {
  it('liefert für öffentliche Inserate stabile URLs ohne Signatur', () => {
    expect(urls.url('img1', 'thumb', false)).toBe('https://api.example.at/v1/images/img1/thumb');
  });

  it('signiert URLs für nicht öffentliche Inserate zeitlich begrenzt', () => {
    const url = new URL(urls.url('img1', 'large', true, now));
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    // Auf die nächste volle Stunde gerundet plus eine Stunde
    expect(new Date(Number(exp)).toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(urls.verify('img1', 'large', exp, sig, now)).toBe(true);
    expect(urls.verify('img1', 'thumb', exp, sig, now)).toBe(false);
    expect(urls.verify('img2', 'large', exp, sig, now)).toBe(false);
    expect(urls.verify('img1', 'large', String(Number(exp) + 1), sig, now)).toBe(false);
    expect(urls.verify('img1', 'large', exp, sig, Number(exp) + 1)).toBe(false);
    expect(urls.verify('img1', 'large', undefined, undefined, now)).toBe(false);
  });
});
