'use server';

import { redirect } from 'next/navigation';
import { reportListingSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

export async function reportListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const listingId = String(formData.get('listingId') ?? '');
  if (!ENTITY_ID.test(listingId)) return { status: 'error', message: 'Diese Anzeige gibt es nicht.' };
  const values = { reason: String(formData.get('reason') ?? ''), details: String(formData.get('details') ?? '') };
  const { token } = await requireUser(`/melden?anzeige=${listingId}`);
  const parsed = reportListingSchema.safeParse({
    reason: values.reason || undefined,
    details: values.details,
    goodFaith: formData.get('goodFaith') === 'on' ? true : undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  }
  try {
    await api(`/listings/${listingId}/report`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  redirect(`/anzeige/${listingId}?hinweis=gemeldet`);
}

export async function reportDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const dealId = String(formData.get('dealId') ?? '');
  if (!ENTITY_ID.test(dealId)) return { status: 'error', message: 'Dieses Angebot gibt es nicht.' };
  const values = { reason: String(formData.get('reason') ?? ''), details: String(formData.get('details') ?? '') };
  const { token } = await requireUser(`/melden?deal=${dealId}`);
  const parsed = reportListingSchema.safeParse({
    reason: values.reason || undefined,
    details: values.details,
    goodFaith: formData.get('goodFaith') === 'on' ? true : undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  }
  try {
    await api(`/deals/${dealId}/report`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  redirect(`/deals/${dealId}?hinweis=gemeldet`);
}
