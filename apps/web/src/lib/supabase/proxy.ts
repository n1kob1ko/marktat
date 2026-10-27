import { createServerClient } from '@supabase/ssr';
import { forwardedFor } from '@/lib/client-ip';
import { serverEnv } from '@/lib/env';
import { authCookieOptions } from './cookie-options';
import { NextResponse, type NextRequest } from 'next/server';

/** Erneuert bei jeder Navigation das Supabase-Access-Token und schreibt die Cookies zurück. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    serverEnv.supabaseUrl,
    serverEnv.supabaseAnonKey,
    {
      cookieOptions: authCookieOptions,
      global: { headers: forwardedFor(request.headers) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Löst bei Bedarf die Token-Erneuerung aus. Kein weiterer Code zwischen Client-Erzeugung und diesem Aufruf.
  await supabase.auth.getClaims();
  return response;
}
