import { serverEnv } from '@/lib/env';
import type { MetadataRoute } from 'next';

/** Vor dem Start (ALLOW_INDEXING nicht gesetzt) bleibt die ganze Seite für Suchmaschinen gesperrt. */
export default function robots(): MetadataRoute.Robots {
  const base = serverEnv.webUrl;
  if (!serverEnv.allowIndexing) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/konto',
        '/konto-geloescht',
        '/admin',
        '/nachrichten',
        '/inserieren',
        '/anmelden',
        '/registrieren',
        '/passwort-neu',
        '/passwort-vergessen',
        '/melden',
        '/auth/',
        '/anzeige/*/bearbeiten',
        '/anzeige/*/bilder',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
