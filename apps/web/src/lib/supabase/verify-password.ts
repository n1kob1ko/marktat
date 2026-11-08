import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { forwardedFor } from '@/lib/client-ip';
import { serverEnv } from '@/lib/env';

/**
 * Prüft das aktuelle Passwort, bevor Passwort oder E-Mail-Adresse geändert werden (Schutz, falls ein
 * angemeldetes Gerät in fremde Hände gerät). Läuft über einen Wegwerf-Client ohne Cookies, damit die
 * eigentliche Sitzung unverändert bleibt; die dabei entstandene Sitzung wird sofort wieder beendet.
 */
export async function verifyPassword(email: string, password: string): Promise<{ ok: true } | { ok: false; error: { code?: string; status?: number; message?: string } }> {
  const client = createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: forwardedFor(await headers()) },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error };
  if (data.session) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return { ok: true };
}
