import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Gemeinsame .env im Repo-Wurzelverzeichnis laden (eine Quelle für API, Web und Docker).
// forceReload, weil Next.js vorher bereits apps/web/.env* eingelesen und zwischengespeichert hat.
const repoRoot = path.join(process.cwd(), '../..');
const isDev = process.env.NODE_ENV !== 'production';
loadEnvConfig(repoRoot, isDev, console, true);
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
const supabaseUrl = process.env.SUPABASE_URL ?? 'http://localhost:54321';

/** Ziel der Browser-Uploads und Bild-Weiterleitungen: R2-Endpoint bzw. die API beim lokalen Speichertreiber. */
function storageUploadOrigin(): string | null {
  if (process.env.STORAGE_DRIVER === 'local') return null; // läuft über die API, ist schon erlaubt
  if (process.env.R2_ENDPOINT) return new URL(process.env.R2_ENDPOINT).origin;
  const account = process.env.R2_ACCOUNT_ID;
  if (!account) return null;
  const jurisdiction = process.env.R2_JURISDICTION;
  const prefix = jurisdiction === 'eu' || jurisdiction === 'fedramp' ? `${jurisdiction}.` : '';
  return `https://${account}.${prefix}r2.cloudflarestorage.com`;
}
const uploadOrigin = storageUploadOrigin();

/**
 * Suchmaschinen erst nach dem offiziellen Start zulassen: ALLOW_INDEXING=true beim Build setzen.
 * Standard ist „nicht indexieren“ (robots.txt sperrt alles, jede Antwort trägt X-Robots-Tag: noindex).
 */
const allowIndexing = process.env.ALLOW_INDEXING === 'true';
/** Persönliche und interne Bereiche: nie in Suchmaschinen, auch nach dem Start nicht */
const PRIVATE_PATHS = [
  '/konto/:path*',
  '/konto-geloescht',
  '/admin/:path*',
  '/nachrichten/:path*',
  '/inserieren',
  '/anzeige/:id/bearbeiten',
  '/anzeige/:id/bilder',
  '/anmelden/:path*',
  '/registrieren',
  '/passwort-neu',
  '/passwort-vergessen',
  '/melden',
  '/auth/:path*',
];

/**
 * Content-Security-Policy. 'unsafe-inline' für Skripte ist nötig, solange keine Nonces verwendet werden
 * (offene Aufgabe: nonce-basierte CSP über proxy.ts, siehe docs/sicherheit.md).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Bilder kommen über die API (Weiterleitung auf R2); blob: für die Vorschau vor dem Upload
  `img-src 'self' data: blob: https: ${apiUrl}${uploadOrigin ? ` ${uploadOrigin}` : ''}`,
  "font-src 'self' data:",
  `connect-src 'self' ${apiUrl} ${supabaseUrl}${uploadOrigin ? ` ${uploadOrigin}` : ''}${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  transpilePackages: ['@marktat/ui'],
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
    NEXT_PUBLIC_WEB_URL: process.env.WEB_URL ?? 'http://localhost:3000',
    ALLOW_INDEXING: String(allowIndexing),
  },
  turbopack: {
    root: repoRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
          ...(allowIndexing ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
        ],
      },
      ...PRIVATE_PATHS.map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] })),
    ];
  },
};

export default nextConfig;
