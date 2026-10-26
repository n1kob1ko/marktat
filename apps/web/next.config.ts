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

/**
 * Content-Security-Policy. 'unsafe-inline' für Skripte ist nötig, solange keine Nonces verwendet werden
 * (offene Aufgabe: nonce-basierte CSP über proxy.ts, siehe docs/sicherheit.md).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiUrl} ${supabaseUrl}${isDev ? ' ws:' : ''}`,
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
        ],
      },
    ];
  },
};

export default nextConfig;
