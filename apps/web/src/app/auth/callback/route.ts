import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

/**
 * Rückkehr von Google bzw. Apple (OAuth, PKCE): Supabase Auth hat den Anbieter geprüft und schickt einen Code,
 * der hier gegen eine Sitzung getauscht wird (Cookies). Danach geht es zur gewünschten Seite weiter.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = serverEnv.webUrl;
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'), '/konto');

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  // Abbruch beim Anbieter, abgelehnte Freigabe oder abgelaufener Code
  return NextResponse.redirect(new URL('/anmelden?fehler=anbieter', origin));
}
