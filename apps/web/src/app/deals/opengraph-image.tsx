import { brandOgImage, ogSize } from '@/lib/og-image';

/** Vorschaubild für geteilte Deal-Links; einzelne Deals mit Produktfoto bringen ihr eigenes mit */
export const alt = 'Deals auf Markterl – Preise vergleichen und sparen';
export const size = ogSize;
export const contentType = 'image/jpeg';

export default function OpengraphImage() {
  return brandOgImage({
    photo: 'deals',
    title: 'Die besten Deals',
    accent: 'aus Österreich.',
    sub: 'Preise vergleichen, Preisalarm setzen, sparen',
  });
}
