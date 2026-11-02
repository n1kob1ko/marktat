'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { changeAccountTypeSchema, updateProfileSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const FIELDS = ['displayName', 'bio', 'phone', 'companyName', 'companyRegisterNumber', 'vatId', 'companyAddress', 'website'] as const;

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, token } = await requireUser('/konto');
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (typeof value === 'string') values[field] = value;
  }
  if (user.accountType !== 'BUSINESS') {
    for (const field of ['companyName', 'companyRegisterNumber', 'vatId', 'companyAddress', 'website']) delete values[field];
  }
  const parsed = updateProfileSchema.safeParse(user.accountType === 'BUSINESS' ? { ...values, showPhone: formData.get('showPhone') === 'on' } : values);
  if (!parsed.success) {
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  }
  try {
    await api('/me', { method: 'PATCH', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  revalidatePath('/konto');
  return { status: 'success', message: 'Dein Profil wurde gespeichert.' };
}

/** Nur Administratorkonten: Kontotyp privat/gewerblich wechseln (gewerbliche Angebote ohne Händlerangaben) */
export async function changeAccountTypeAction(formData: FormData): Promise<void> {
  const { user, token } = await requireUser('/konto');
  const parsed = changeAccountTypeSchema.safeParse({ accountType: formData.get('accountType') });
  if (user.role !== 'ADMIN' || !parsed.success) redirect('/konto?kontotyp=fehler');
  let failed = false;
  try {
    await api('/me/account-type', { method: 'PATCH', token, body: parsed.data });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    failed = true;
  }
  revalidatePath('/', 'layout');
  redirect(failed ? '/konto?kontotyp=fehler' : `/konto?kontotyp=${parsed.data.accountType === 'BUSINESS' ? 'gewerblich' : 'privat'}`);
}
