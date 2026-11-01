import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Markterl – Kleinanzeigen für Österreich',
    short_name: 'Markterl',
    description: 'Kaufen und verkaufen in ganz Österreich.',
    lang: 'de-AT',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4ef',
    theme_color: '#0f4c3a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
