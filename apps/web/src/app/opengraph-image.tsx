import { brandOgImage, ogSize } from '@/lib/og-image';

/** Vorschaubild, wenn ein Link auf Markterl geteilt wird (WhatsApp, Facebook …) und die Seite kein eigenes Foto hat */
export const alt = 'Markterl – Kleinanzeigen für Österreich';
export const size = ogSize;
export const contentType = 'image/jpeg';

export default function OpengraphImage() {
  return brandOgImage({
    photo: 'startseite',
    title: 'Gutes findet man',
    accent: 'um die Ecke.',
    sub: 'Kostenlos inserieren und finden – in ganz Österreich',
  });
}
