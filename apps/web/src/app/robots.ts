import { serverEnv } from '@/lib/env';
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = serverEnv.webUrl;
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/konto', '/inserieren', '/anmelden', '/registrieren', '/auth/'] },
    host: base,
  };
}
