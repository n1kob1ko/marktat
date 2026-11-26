import { brandOgImage, ogSize } from '@/lib/og-image';

/** Vorschaubild für geteilte Links auf Dienstleistungen und Anbieterprofile */
export const alt = 'Dienstleistungen auf Markterl – Hilfe vom Profi in deiner Nähe';
export const size = ogSize;
export const contentType = 'image/jpeg';

export default function OpengraphImage() {
  return brandOgImage({
    photo: 'dienstleistungen',
    title: 'Hilfe vom Profi',
    accent: 'in deiner Nähe.',
    sub: 'Dienstleister finden und direkt anfragen',
  });
}
