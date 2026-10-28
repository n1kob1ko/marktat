'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSavedSearchSchema, SAVED_SEARCH_KINDS, savedSearchNameSchema, type SavedSearchKind } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, requireUser, safeRedirectPath } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { SAVED_SEARCH_SUCCESS } from '@/lib/saved-searches';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

function parseJson(value: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return undefined;
  }
}

/** „Suche speichern“ auf der Ergebnisseite. Die API prüft die Parameter mit derselben Logik wie die Suche. */
export async function saveSearchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const returnTo = safeRedirectPath(formData.get('returnTo'), '/suche');
  const token = await getAccessToken();
  if (!token) redirect(`/anmelden?weiter=${encodeURIComponent(returnTo)}&hinweis=suche`);

  const name = String(formData.get('name') ?? '');
  const rawKind = String(formData.get('kind') ?? 'LISTINGS');
  const kind: SavedSearchKind = (SAVED_SEARCH_KINDS as readonly string[]).includes(rawKind) ? (rawKind as SavedSearchKind) : 'LISTINGS';
  const parsed = createSavedSearchSchema.safeParse({
    kind,
    name,
    params: parseJson(formData.get('params')),
    labels: parseJson(formData.get('labels')) ?? [],
    notify: formData.get('notify') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Bitte prüfe den Namen.', fieldErrors: zodFieldErrors(parsed.error.issues), values: { name } };
  }
  try {
    await api('/me/searches', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, values: { name } };
    throw error;
  }
  revalidatePath('/konto/suchen');
  return {
    status: 'success',
    message: parsed.data.notify ? SAVED_SEARCH_SUCCESS[kind] : 'Die Suche ist gespeichert.',
  };
}

/** Umbenennen und Benachrichtigung ein/aus in „Gespeicherte Suchen“ */
export async function updateSavedSearchAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const intent = String(formData.get('intent') ?? '');
  const { token } = await requireUser('/konto/suchen');
  if (!ID_PATTERN.test(id)) redirect('/konto/suchen?fehler=aktion');

  let body: { name?: string; notify?: boolean };
  let hinweis: string;
  if (intent === 'rename') {
    const name = savedSearchNameSchema.safeParse(String(formData.get('name') ?? ''));
    if (!name.success) redirect(`/konto/suchen?fehler=name&bearbeiten=${id}`);
    body = { name: name.data };
    hinweis = 'umbenannt';
  } else if (intent === 'notify-on' || intent === 'notify-off') {
    body = { notify: intent === 'notify-on' };
    hinweis = intent === 'notify-on' ? 'alarm-an' : 'alarm-aus';
  } else {
    redirect('/konto/suchen?fehler=aktion');
  }
  try {
    await api(`/me/searches/${id}`, { method: 'PATCH', token, body });
  } catch {
    redirect('/konto/suchen?fehler=aktion');
  }
  revalidatePath('/konto/suchen');
  redirect(`/konto/suchen?hinweis=${hinweis}`);
}

export async function deleteSavedSearchAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const { token } = await requireUser('/konto/suchen');
  if (ID_PATTERN.test(id)) {
    try {
      await api(`/me/searches/${id}`, { method: 'DELETE', token });
    } catch {
      redirect('/konto/suchen?fehler=aktion');
    }
  }
  revalidatePath('/konto/suchen');
  redirect('/konto/suchen?hinweis=suche-geloescht');
}
