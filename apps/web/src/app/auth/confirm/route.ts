import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/auth';
import { serverEnv } from '@/lib/env';

const ALLOWED_TYPES: EmailOtpType[] = ['email', 'signup', 'recovery', 'email_change'];

/**
 * Ziel der Links aus Bestätigungs- und Passwort-E-Mails (siehe infra/email-templates).
 * Prüft den Token-Hash bei Supabase Auth und setzt die Sitzungs-Cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Hinter dem Reverse-Proxy kennt der Server nur seine interne Adresse (z. B. 0.0.0.0:3000) – Ziel ist die öffentliche
  const origin = serverEnv.webUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  let next = safeRedirectPath(searchParams.get('next'), '/konto');
  // Beim Registrieren gemerktes Ziel (z. B. /inserieren) – nur im selben Browser vorhanden, sonst bleibt /konto
  const remembered = request.cookies.get('nach_bestaetigung')?.value;
  if (type !== 'recovery' && next === '/konto' && remembered) next = safeRedirectPath(remembered, '/konto');

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const target = new URL(next, origin);
      if (type !== 'recovery') target.searchParams.set('bestaetigt', '1');
      const response = NextResponse.redirect(target);
      if (remembered) response.cookies.delete('nach_bestaetigung');
      return response;
    }
  }
  return NextResponse.redirect(new URL('/anmelden?fehler=link', origin));
}
