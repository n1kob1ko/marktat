'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rateSchema, ratingReplySchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

/** Andere Person bewerten bzw. die eigene Bewertung ändern */
export async function rateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const conversationId = String(formData.get('conversationId') ?? '');
  if (!ENTITY_ID.test(conversationId))
    return { status: 'error', message: 'Diese Unterhaltung gibt es nicht.' };
  const values = {
    stars: String(formData.get('stars') ?? ''),
    comment: String(formData.get('comment') ?? ''),
  };
  const parsed = rateSchema.safeParse({
    stars: values.stars || undefined,
    comment: values.comment,
  });
  if (!parsed.success)
    return {
      status: 'error',
      message: 'Bitte prüfe die markierten Felder.',
      fieldErrors: zodFieldErrors(parsed.error.issues),
      values,
    };
  const { token } = await requireUser(`/bewerten/${conversationId}`);
  try {
    await api(`/conversations/${conversationId}/rating`, {
      method: 'PUT',
      token,
      body: parsed.data,
    });
  } catch (error) {
    if (error instanceof ApiError)
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  revalidatePath('/bewertungen/[id]', 'page');
  redirect(`/bewerten/${conversationId}?hinweis=bewertet`);
}

export async function deleteRatingAction(formData: FormData) {
  const conversationId = String(formData.get('conversationId') ?? '');
  if (!ENTITY_ID.test(conversationId)) return;
  const { token } = await requireUser(`/bewerten/${conversationId}`);
  await api(`/conversations/${conversationId}/rating`, { method: 'DELETE', token }).catch(
    (error: unknown) => {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    },
  );
  revalidatePath('/bewertungen/[id]', 'page');
  redirect(`/bewerten/${conversationId}?hinweis=bewertung-geloescht`);
}

/** Öffentliche Antwort auf eine Bewertung über mich */
export async function replyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ratingId = String(formData.get('ratingId') ?? '');
  if (!ENTITY_ID.test(ratingId))
    return { status: 'error', message: 'Diese Bewertung gibt es nicht.' };
  const values = { body: String(formData.get('body') ?? '') };
  const parsed = ratingReplySchema.safeParse(values);
  if (!parsed.success)
    return {
      status: 'error',
      message: 'Bitte prüfe die markierten Felder.',
      fieldErrors: zodFieldErrors(parsed.error.issues),
      values,
    };
  const { token } = await requireUser('/konto/bewertungen');
  try {
    await api(`/ratings/${ratingId}/reply`, { method: 'PUT', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError)
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  revalidatePath('/bewertungen/[id]', 'page');
  redirect('/konto/bewertungen?hinweis=antwort-gespeichert');
}

export async function deleteReplyAction(formData: FormData) {
  const ratingId = String(formData.get('ratingId') ?? '');
  if (!ENTITY_ID.test(ratingId)) return;
  const { token } = await requireUser('/konto/bewertungen');
  await api(`/ratings/${ratingId}/reply`, { method: 'DELETE', token });
  revalidatePath('/bewertungen/[id]', 'page');
  redirect('/konto/bewertungen?hinweis=antwort-geloescht');
}
