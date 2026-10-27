'use server';

import { redirect } from 'next/navigation';
import { appealSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

export async function appealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const decisionId = String(formData.get('decisionId') ?? '');
  if (!ENTITY_ID.test(decisionId)) return { status: 'error', message: 'Diese Entscheidung gibt es nicht.' };
  const values = { body: String(formData.get('body') ?? '') };
  const parsed = appealSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser(`/konto/entscheidungen/${decisionId}`, { allowSuspended: true });
  try {
    await api(`/me/decisions/${decisionId}/appeal`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  redirect(`/konto/entscheidungen/${decisionId}?hinweis=einspruch-eingereicht`);
}
