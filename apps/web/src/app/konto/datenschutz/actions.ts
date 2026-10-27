'use server';

import { redirect } from 'next/navigation';
import { accountDeletionSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Kontolöschung: Passwort und Bestätigungswort prüft die API (erneute Anmeldung bei Supabase Auth). */
export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { confirmation: String(formData.get('confirmation') ?? '') };
  const parsed = accountDeletionSchema.safeParse({ password: String(formData.get('password') ?? ''), ...values });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser('/konto/datenschutz', { allowSuspended: true });
  try {
    await api('/me/deletion', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  // Die API hat alle Sitzungen beendet; das lokale Sitzungs-Cookie entfernen wir hier.
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  redirect('/konto-geloescht');
}
