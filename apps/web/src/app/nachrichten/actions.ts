'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  CONVERSATION_REPORT_REASONS,
  reportUserSchema,
  sendMessageSchema,
  type ChatMessage,
  type MessagePage,
  type UnreadSummary,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T> = { ok: true; data: T } | { ok: false; message: string; status?: number };

function failure(error: unknown): { ok: false; message: string; status?: number } {
  if (error instanceof ApiError) return { ok: false, message: error.message, status: error.status };
  return { ok: false, message: 'Das hat nicht geklappt. Bitte versuche es erneut.' };
}

async function tokenOrFailure(): Promise<string | { ok: false; message: string; status: number }> {
  const token = await getAccessToken();
  return token ?? { ok: false, message: 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.', status: 401 };
}

/** Erste Nachricht von der Detailseite. Führt danach direkt in die Unterhaltung. */
export async function startConversationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const listingId = String(formData.get('listingId') ?? '');
  const body = String(formData.get('body') ?? '');
  if (!ID_PATTERN.test(listingId)) return { status: 'error', message: 'Diese Anzeige gibt es nicht.' };
  const token = await getAccessToken();
  if (!token) redirect(`/anmelden?weiter=${encodeURIComponent(`/anzeige/${listingId}`)}&hinweis=nachricht`);

  const parsed = sendMessageSchema.safeParse({ body });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values: { body } };
  let conversationId: string;
  try {
    ({ conversationId } = await api<{ conversationId: string }>(`/listings/${listingId}/conversations`, {
      method: 'POST',
      token,
      body: parsed.data,
    }));
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, values: { body } };
    throw error;
  }
  redirect(`/nachrichten/${conversationId}`);
}

export async function sendMessageAction(conversationId: string, body: string): Promise<Result<ChatMessage>> {
  if (!ID_PATTERN.test(conversationId)) return { ok: false, message: 'Diese Unterhaltung gibt es nicht.', status: 404 };
  const parsed = sendMessageSchema.safeParse({ body });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Ungültige Nachricht.', status: 400 };
  const token = await tokenOrFailure();
  if (typeof token !== 'string') return token;
  try {
    return { ok: true, data: await api<ChatMessage>(`/conversations/${conversationId}/messages`, { method: 'POST', token, body: parsed.data }) };
  } catch (error) {
    return failure(error);
  }
}

/** Ältere Nachrichten (before) oder verpasste nach einer Unterbrechung (after) */
export async function loadMessagesAction(conversationId: string, cursor: { before?: string; after?: string }): Promise<Result<MessagePage>> {
  if (!ID_PATTERN.test(conversationId)) return { ok: false, message: 'Diese Unterhaltung gibt es nicht.', status: 404 };
  const params = new URLSearchParams();
  if (cursor.before && ID_PATTERN.test(cursor.before)) params.set('before', cursor.before);
  if (cursor.after && ID_PATTERN.test(cursor.after)) params.set('after', cursor.after);
  const token = await tokenOrFailure();
  if (typeof token !== 'string') return token;
  try {
    return { ok: true, data: await api<MessagePage>(`/conversations/${conversationId}/messages?${params}`, { token, cache: 'no-store' }) };
  } catch (error) {
    return failure(error);
  }
}

export async function markReadAction(conversationId: string): Promise<Result<UnreadSummary>> {
  if (!ID_PATTERN.test(conversationId)) return { ok: false, message: 'Diese Unterhaltung gibt es nicht.', status: 404 };
  const token = await tokenOrFailure();
  if (typeof token !== 'string') return token;
  try {
    return { ok: true, data: await api<UnreadSummary>(`/conversations/${conversationId}/read`, { method: 'POST', token }) };
  } catch (error) {
    return failure(error);
  }
}

/** Blockieren bzw. Blockierung aufheben – aus dem Chat und den Benachrichtigungseinstellungen */
export async function blockUserAction(formData: FormData) {
  const userId = String(formData.get('userId') ?? '');
  const action = formData.get('action') === 'unblock' ? 'unblock' : 'block';
  const conversationId = String(formData.get('conversationId') ?? '');
  const back = ID_PATTERN.test(conversationId) ? `/nachrichten/${conversationId}` : '/konto/benachrichtigungen';
  const { token } = await requireUser(back);
  if (!USER_ID_PATTERN.test(userId)) redirect(`${back}?fehler=aktion`);
  try {
    await api(`/users/${userId}/block`, { method: action === 'block' ? 'POST' : 'DELETE', token });
  } catch {
    redirect(`${back}?fehler=aktion`);
  }
  revalidatePath(back);
  redirect(`${back}?hinweis=${action === 'block' ? 'blockiert' : 'entblockt'}`);
}

export async function reportUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const conversationId = String(formData.get('conversationId') ?? '');
  const values = { reason: String(formData.get('reason') ?? ''), details: String(formData.get('details') ?? '') };
  if (!ID_PATTERN.test(conversationId)) return { status: 'error', message: 'Diese Unterhaltung gibt es nicht.' };
  const { token } = await requireUser(`/nachrichten/${conversationId}`);
  const parsed = reportUserSchema.safeParse({
    reason: (CONVERSATION_REPORT_REASONS as readonly string[]).includes(values.reason) ? values.reason : undefined,
    details: values.details,
  });
  if (!parsed.success) return { status: 'error', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  try {
    await api(`/conversations/${conversationId}/report`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, values };
    throw error;
  }
  return { status: 'success', message: 'Danke für deine Meldung. Unser Team sieht sie sich an.' };
}
