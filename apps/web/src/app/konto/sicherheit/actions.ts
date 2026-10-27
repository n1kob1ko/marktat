'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { mfaFactorNameSchema, totpCodeSchema } from '@marktat/shared';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { isStaff, requireUser } from '@/lib/auth';
import type { FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Höchstzahl eingerichteter Geräte (Supabase erlaubt mehr; zwei bis drei reichen als Ersatz) */
const MAX_FACTORS = 3;

async function requireStaffSession() {
  const session = await requireUser('/konto/sicherheit');
  if (!isStaff(session.user)) redirect('/konto');
  return session;
}

/** Protokolliert die Änderung; die API liest den tatsächlichen Stand selbst aus Supabase. */
async function record(event: 'enrolled' | 'removed') {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  await api('/me/mfa/events', { method: 'POST', token: data.session.access_token, body: { event } }).catch(() => undefined);
}

/** Schritt 1: neues Gerät anlegen. Liefert QR-Code und Schlüssel; aktiv wird es erst mit einem gültigen Code. */
export async function startEnrollAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireStaffSession();
  const name = mfaFactorNameSchema.safeParse(String(formData.get('name') ?? ''));
  if (!name.success) return { status: 'error', fieldErrors: { name: [name.error.issues[0]!.message] }, values: { name: String(formData.get('name') ?? '') } };

  const supabase = await createSupabaseServerClient();
  const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { status: 'error', message: authErrorMessage(listError) };
  if (list.totp.length >= MAX_FACTORS) return { status: 'error', message: `Du hast bereits ${MAX_FACTORS} Geräte eingerichtet. Entferne zuerst eines.` };
  // Abgebrochene Einrichtungen aufräumen (unbestätigte Faktoren gelten nicht und blockieren sonst den Namen)
  for (const factor of list.all) {
    if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: name.data, issuer: 'MarktAT' });
  if (error) return { status: 'error', message: authErrorMessage(error), values: { name: name.data } };
  return {
    status: 'success',
    values: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, name: name.data },
  };
}

/** Schritt 2: Code aus der App bestätigt das Gerät – erst dann ist die 2FA aktiv (Schutz vor Aussperren). */
export async function confirmEnrollAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireStaffSession();
  const factorId = String(formData.get('factorId') ?? '');
  const kept = { factorId, qrCode: String(formData.get('qrCode') ?? ''), secret: String(formData.get('secret') ?? ''), name: String(formData.get('name') ?? '') };
  const code = totpCodeSchema.safeParse(String(formData.get('code') ?? ''));
  if (!code.success) return { status: 'success', fieldErrors: { code: [code.error.issues[0]!.message] }, values: kept };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
  if (error) return { status: 'success', fieldErrors: { code: [authErrorMessage(error)] }, values: kept };
  await record('enrolled');
  revalidatePath('/konto/sicherheit');
  redirect('/konto/sicherheit?hinweis=2fa-aktiv');
}

/** Gerät entfernen – nur in einer mit 2FA bestätigten Sitzung (verlangt Supabase). */
export async function removeFactorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user } = await requireStaffSession();
  const factorId = String(formData.get('factorId') ?? '');
  const supabase = await createSupabaseServerClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  const verified = list?.totp ?? [];
  if (!verified.some((f) => f.id === factorId)) return { status: 'error', message: 'Dieses Gerät gibt es nicht mehr. Bitte lade die Seite neu.' };
  if (verified.length === 1 && user.security?.mfaRequired) {
    return { status: 'error', message: 'Die Zwei-Faktor-Anmeldung ist für dein Konto Pflicht. Richte zuerst ein anderes Gerät ein und entferne dann dieses.' };
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { status: 'error', message: authErrorMessage(error) };
  // Sitzung neu ausstellen, damit sie den aktuellen Stand der Faktoren kennt
  await supabase.auth.refreshSession();
  await record('removed');
  revalidatePath('/konto/sicherheit');
  redirect('/konto/sicherheit?hinweis=2fa-entfernt');
}
