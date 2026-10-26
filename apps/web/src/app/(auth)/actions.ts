'use server';

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
import { safeRedirectPath } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

/** Version der Nutzungsbedingungen, der beim Registrieren zugestimmt wird (siehe /agb). */
const TERMS_VERSION = '2026-10-entwurf';

function siteUrl() {
  return serverEnv.webUrl;
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
      data: {
        display_name: parsed.data.displayName,
        account_type: parsed.data.accountType,
        company_name: parsed.data.companyName ?? null,
        terms_version: TERMS_VERSION,
      },
    },
  });
  if (error) return { status: 'error', message: authErrorMessage(error), values };

  // Aus Datenschutzgründen dieselbe Antwort, egal ob die Adresse schon registriert ist.
  return {
    status: 'success',
    message: `Fast geschafft! Wir haben eine E-Mail an ${parsed.data.email} geschickt. Bitte bestätige darin deine Adresse.`,
  };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get('email') ?? '') };
  const parsed = loginSchema.safeParse({ ...values, password: String(formData.get('password') ?? '') });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: 'error', message: authErrorMessage(error), values };

  redirect(safeRedirectPath(formData.get('weiter')));
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
