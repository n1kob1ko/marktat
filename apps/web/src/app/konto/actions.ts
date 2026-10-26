'use server';

import { revalidatePath } from 'next/cache';
import { updateProfileSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const FIELDS = ['displayName', 'bio', 'phone', 'companyName', 'companyRegisterNumber', 'vatId', 'companyAddress'] as const;

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, token } = await requireUser('/konto');
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (typeof value === 'string') values[field] = value;
  }
  if (user.accountType !== 'BUSINESS') {
    for (const field of ['companyName', 'companyRegisterNumber', 'vatId', 'companyAddress']) delete values[field];
  }
  const parsed = updateProfileSchema.safeParse(values);
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
