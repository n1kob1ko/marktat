import { serverEnv } from '@/lib/env';

/**
 * Sitzungs-Cookies von Supabase Auth. Die Sitzung wird nur serverseitig gelesen (kein Supabase-Client im Browser),
 * daher httpOnly; über HTTPS zusätzlich secure.
 */
export const authCookieOptions = {
  httpOnly: true,
  secure: serverEnv.webUrl.startsWith('https://'),
  sameSite: 'lax' as const,
  path: '/',
};
