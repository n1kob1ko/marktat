'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@marktat/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { authErrorMessage } from '@/lib/auth-errors';
import { enabledProviders, isSocialProvider } from '@/lib/auth-providers';
import { safeRedirectPath } from '@/lib/auth';
import { captchaToken } from '@/lib/captcha';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { getAssurance, needsSecondFactor, verifyTotp } from '@/lib/mfa';

/** Version der Nutzungsbedingungen, der beim Registrieren zugestimmt wird (siehe /agb; gleich halten mit apps/api/src/users/terms.ts). */
const TERMS_VERSION = '2026-10-entwurf';

/** Ziel nach der E-Mail-Bestätigung, gesetzt beim Registrieren (gelesen in /auth/confirm) */
const AFTER_CONFIRM_COOKIE = 'nach_bestaetigung';

function siteUrl() {
  return serverEnv.webUrl;
}

async function rememberTargetAfterConfirm(formData: FormData) {
  const next = safeRedirectPath(formData.get('weiter'), '');
  if (next && next !== '/konto') {
    (await cookies()).set(AFTER_CONFIRM_COOKIE, next, { httpOnly: true, sameSite: 'lax', secure: siteUrl().startsWith('https:'), maxAge: 60 * 60 * 24, path: '/' });
  }
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Honeypot gegen einfache Bots: echtes Publikum sieht dieses Feld nicht.
  if (formData.get('website')) return { status: 'success' };

  const values = {
    email: String(formData.get('email') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    accountType: String(formData.get('accountType') ?? 'PRIVATE'),
    companyName: String(formData.get('companyName') ?? ''),
  };
  const parsed = registerSchema.safeParse({
    ...values,
    companyName: values.companyName || undefined,
    password: String(formData.get('password') ?? ''),
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm`,
      captchaToken: captchaToken(formData),
      data: {
        display_name: parsed.data.displayName,
        account_type: parsed.data.accountType,
        company_name: parsed.data.companyName ?? null,
        terms_version: TERMS_VERSION,
      },
    },
  });
  if (error) return { status: 'error', message: authErrorMessage(error), values };

  // Wohin es nach der Bestätigung gehen soll (z. B. „Inserieren“ angetippt, dann registriert). Der Link in der
  // E-Mail führt immer zu /konto; im selben Browser leitet /auth/confirm mit diesem Cookie weiter.
  await rememberTargetAfterConfirm(formData);

  // Aus Datenschutzgründen dieselbe Antwort, egal ob die Adresse schon registriert ist.
  return {
    status: 'success',
    message: `Fast geschafft! Wir haben eine E-Mail an ${parsed.data.email} geschickt. Bitte bestätige darin deine Adresse.`,
    values: { email: parsed.data.email },
  };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get('email') ?? '') };
  const parsed = loginSchema.safeParse({ ...values, password: String(formData.get('password') ?? '') });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: { captchaToken: captchaToken(formData) } });
  // Unbestätigte Adresse: das Formular bietet dann „Bestätigungs-E-Mail nochmal senden“ an
  if (error) return { status: 'error', message: authErrorMessage(error), values: { ...values, ...(error.code === 'email_not_confirmed' ? { unbestaetigt: '1' } : {}) } };

  const target = safeRedirectPath(formData.get('weiter'));
  // Mit eingerichteter Zwei-Faktor-Anmeldung ist die Anmeldung erst nach dem Code vollständig
  if (needsSecondFactor(await getAssurance())) redirect(`/anmelden/zwei-faktor?weiter=${encodeURIComponent(target)}`);
  redirect(target);
}

/**
 * Bestätigungs-E-Mail erneut senden (nach der Registrierung oder wenn die Anmeldung an der unbestätigten Adresse
 * scheitert). Antwortet immer gleich, damit sich nicht herausfinden lässt, ob eine Adresse registriert ist.
 */
export async function resendConfirmationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get('email') ?? '') };
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: parsed.data.email,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm`, captchaToken: captchaToken(formData) },
  });
  // Supabase Auth erlaubt je Adresse nur eine Mail pro Minute
  if (error?.code === 'over_email_send_rate_limit') {
    return { status: 'error', message: 'Die E-Mail wurde gerade erst verschickt. Bitte warte eine Minute, bevor du sie nochmal anforderst.', values };
  }
  if (error && (error.status === 429 || error.code === 'captcha_failed')) return { status: 'error', message: authErrorMessage(error), values };
  await rememberTargetAfterConfirm(formData);
  return { status: 'success', message: `Wir haben die E-Mail noch einmal an ${parsed.data.email} geschickt. Schau auch im Spam-Ordner nach.`, values };
}

/** Zweiter Schritt der Anmeldung: Code aus der Authenticator-App */
export async function verifySecondFactorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await verifyTotp(String(formData.get('code') ?? ''));
  if ('error' in result) return { status: 'error', message: result.error, fieldErrors: { code: [result.error] } };
  redirect(safeRedirectPath(formData.get('weiter')));
}

/**
 * Anmeldung bzw. Registrierung über Google oder Apple: Supabase Auth leitet zum Anbieter, dieser zurück zu
 * Supabase Auth und von dort zu /auth/callback (PKCE – der Prüfwert liegt im Cookie).
 */
export async function oauthAction(formData: FormData) {
  const provider = formData.get('provider');
  if (!isSocialProvider(provider) || !enabledProviders.includes(provider)) redirect('/anmelden?fehler=anbieter');
  const target = safeRedirectPath(formData.get('weiter'));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(target)}`, skipBrowserRedirect: true },
  });
  if (error || !data.url) redirect('/anmelden?fehler=anbieter');
  redirect(data.url);
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get('email') ?? '') };
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/passwort-neu`,
    captchaToken: captchaToken(formData),
  });
  if (error && error.status === 429) return { status: 'error', message: authErrorMessage(error), values };

  // Keine Auskunft darüber, ob die Adresse registriert ist (Schutz vor Konto-Ausspähung)
  return {
    status: 'success',
    message: 'Wenn ein Konto mit dieser Adresse existiert, bekommst du in wenigen Minuten eine E-Mail mit einem Link.',
  };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: String(formData.get('password') ?? ''),
    passwordConfirm: String(formData.get('passwordConfirm') ?? ''),
  });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues) };

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return { status: 'error', message: 'Der Link ist abgelaufen. Bitte fordere einen neuen an.' };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: 'error', message: authErrorMessage(error) };

  redirect('/konto?passwort=geaendert');
}
