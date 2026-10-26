import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/auth';

const ALLOWED_TYPES: EmailOtpType[] = ['email', 'signup', 'recovery', 'email_change'];

/**
 * Ziel der Links aus Bestätigungs- und Passwort-E-Mails (siehe infra/email-templates).
 * Prüft den Token-Hash bei Supabase Auth und setzt die Sitzungs-Cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get('next'), '/konto');

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const target = new URL(next, origin);
      if (type !== 'recovery') target.searchParams.set('bestaetigt', '1');
      return NextResponse.redirect(target);
    }
  }
  return NextResponse.redirect(new URL('/anmelden?fehler=link', origin));
}
