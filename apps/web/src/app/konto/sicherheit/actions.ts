'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { changeEmailSchema, changePasswordSchema, mfaFactorNameSchema, totpCodeSchema } from '@marktat/shared';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { isStaff, requireUser } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { verifyPassword } from '@/lib/supabase/verify-password';
import { captchaToken } from '@/lib/captcha';

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

/** Protokolliert Passwort- und E-Mail-Änderungen; bei einem neuen Passwort warnt die API zusätzlich per E-Mail. */
async function recordSecurityEvent(token: string, event: 'password_changed' | 'email_change_requested') {
  await api('/me/security/events', { method: 'POST', token, body: { event } }).catch(() => undefined);
}

function wrongPassword(error: { code?: string; status?: number; message?: string }) {
  return error.code === 'invalid_credentials' ? 'Das aktuelle Passwort stimmt nicht.' : authErrorMessage(error);
}

/** Passwort ändern – nur mit dem aktuellen Passwort; auf Wunsch werden alle anderen Geräte abgemeldet. */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, token } = await requireUser('/konto/sicherheit');
  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(formData.get('currentPassword') ?? ''),
    password: String(formData.get('password') ?? ''),
    passwordConfirm: String(formData.get('passwordConfirm') ?? ''),
    signOutOthers: formData.get('signOutOthers') === 'on',
  });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues) };
  if (parsed.data.password === parsed.data.currentPassword) {
    return { status: 'error', fieldErrors: { password: ['Das neue Passwort muss sich vom bisherigen unterscheiden.'] } };
  }

  const check = await verifyPassword(user.email, parsed.data.currentPassword, captchaToken(formData));
  if (!check.ok) return { status: 'error', fieldErrors: { currentPassword: [wrongPassword(check.error)] } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: 'error', message: authErrorMessage(error) };
  if (parsed.data.signOutOthers) await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
  await recordSecurityEvent(token, 'password_changed');
  redirect(`/konto/sicherheit?hinweis=${parsed.data.signOutOthers ? 'passwort-geaendert-abgemeldet' : 'passwort-geaendert'}`);
}

/**
 * E-Mail-Adresse ändern – nur mit Passwort. Supabase Auth schickt an die bisherige und die neue Adresse je einen
 * Bestätigungslink; erst wenn beide geöffnet wurden, gilt die neue Adresse (siehe infra/email-templates/email-change.html).
 */
export async function changeEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, token } = await requireUser('/konto/sicherheit');
  const values = { email: String(formData.get('email') ?? '') };
  const parsed = changeEmailSchema.safeParse({ ...values, password: String(formData.get('password') ?? '') });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  if (parsed.data.email.toLowerCase() === user.email.toLowerCase()) {
    return { status: 'error', fieldErrors: { email: ['Das ist bereits deine aktuelle E-Mail-Adresse.'] }, values };
  }

  const check = await verifyPassword(user.email, parsed.data.password, captchaToken(formData));
  if (!check.ok) return { status: 'error', fieldErrors: { password: [wrongPassword(check.error)] }, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email }, { emailRedirectTo: `${serverEnv.webUrl}/auth/confirm` });
  if (error) {
    if (error.code === 'email_exists' || error.code === 'user_already_exists') {
      return { status: 'error', fieldErrors: { email: ['Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.'] }, values };
    }
    return { status: 'error', message: authErrorMessage(error), values };
  }
  await recordSecurityEvent(token, 'email_change_requested');
  revalidatePath('/konto/sicherheit');
  redirect('/konto/sicherheit?hinweis=email-angefordert');
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

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: name.data, issuer: 'Markterl' });
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
