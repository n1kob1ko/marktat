import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { serverEnv } from '@/lib/env';
import { authCookieOptions } from './cookie-options';
import { forwardedFor } from '@/lib/client-ip';
import { cookies, headers } from 'next/headers';

/**
 * Supabase-Client für Server Components, Server Actions und Route Handler.
 * Pro Anfrage neu erzeugen – niemals global zwischenspeichern.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookieOptions: authCookieOptions,
    global: { headers: forwardedFor(await headers()) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // In Server Components dürfen keine Cookies gesetzt werden; proxy.ts erneuert die Sitzung.
        }
      },
    },
  });
}
