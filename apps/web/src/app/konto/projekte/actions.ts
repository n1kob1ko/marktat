'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAustrianPostalCode, parseEuroInputToCents, serviceProjectSchema, type LocationSummary, type MyServiceProject } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;
const PAGE = '/konto/projekte';
const CHECK = 'Bitte prüfe die markierten Felder.';
const TEXT_FIELDS = ['title', 'description', 'categorySlug', 'budgetType', 'budget', 'timeframe'] as const;

/** API-Feldnamen → Formularfeldnamen */
function mapErrors(errors: Record<string, string[] | undefined>) {
  const result: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) (result[key === 'budgetCents' ? 'budget' : key] ??= []).push(...(messages ?? []));
  return result;
}

/** Projektauftrag anlegen (Entwurf) oder speichern; der Ort kommt aus der PLZ-Suche, Euro werden zu Cent */
export async function saveProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (id && !ENTITY_ID.test(id)) return { status: 'error', message: 'Diesen Auftrag gibt es nicht.' };
  const { token } = await requireUser(id ? `${PAGE}/${id}` : `${PAGE}/neu`);
  const values: Record<string, string> = {};
  for (const key of TEXT_FIELDS) values[key] = String(formData.get(key) ?? '');
  values.remote = formData.get('remote') === 'on' ? 'on' : '';
  values.locationId = String(formData.get('ort') ?? '');

  const fieldErrors: Record<string, string[]> = {};
  const budgetCents = values.budget ? parseEuroInputToCents(values.budget) : null;
  if (values.budgetType !== 'OPEN' && values.budget && budgetCents === null) fieldErrors.budget = ['Bitte gib einen gültigen Betrag ein, z. B. 800 oder 35,50.'];
  let locationId = Number(values.locationId) || null;
  // Nur eine PLZ eingetippt, aber keinen Vorschlag gewählt: Ort zur PLZ nachschlagen
  const postalCode = String(formData.get('plz') ?? '').trim();
  if (!locationId && isAustrianPostalCode(postalCode)) {
    const matches = await api<LocationSummary[]>(`/geo/locations?q=${postalCode}`).catch(() => []);
    const match = matches.find((l) => l.postalCode === postalCode);
    if (match) locationId = match.id;
    else fieldErrors.locationId = ['Diese PLZ kennen wir nicht. Bitte wähle einen Ort aus der Liste.'];
  }
  if (Object.keys(fieldErrors).length) return { status: 'error', message: CHECK, fieldErrors, values };

  const parsed = serviceProjectSchema.safeParse({
    title: values.title,
    description: values.description,
    categorySlug: values.categorySlug,
    locationId,
    remote: values.remote === 'on',
    budgetType: values.budgetType || undefined,
    budgetCents: values.budgetType === 'OPEN' ? null : budgetCents,
    timeframe: values.timeframe,
  });
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: mapErrors(zodFieldErrors(parsed.error.issues)), values };
  let saved: MyServiceProject;
  try {
    saved = id
      ? await api<MyServiceProject>(`/me/projects/${id}`, { method: 'PATCH', token, body: parsed.data })
      : await api<MyServiceProject>('/me/projects', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: mapErrors(error.fieldErrors()), values };
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}/${saved.id}?hinweis=projekt-gespeichert`);
}

const OPS = ['publish', 'pause', 'resume', 'close', 'extend', 'resubmit', 'delete'] as const;
type Op = (typeof OPS)[number];
const OP_NOTES: Record<Op, string> = {
  publish: 'projekt-veroeffentlicht',
  pause: 'projekt-pausiert',
  resume: 'projekt-fortgesetzt',
  close: 'projekt-beendet',
  extend: 'projekt-verlaengert',
  resubmit: 'projekt-eingereicht',
  delete: 'projekt-geloescht',
};

/** Statuswechsel eines eigenen Auftrags (Knöpfe mit name="op"); Veröffentlichen und Löschen brauchen eine Bestätigung. */
export async function projectOpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const op = String(formData.get('op') ?? '') as Op;
  if (!ENTITY_ID.test(id) || !OPS.includes(op)) return { status: 'error', message: 'Die Anfrage ist ungültig. Bitte lade die Seite neu.' };
  if ((op === 'publish' || op === 'delete') && formData.get('confirmed') !== 'on') {
    return { status: 'error', message: 'Bitte bestätige zuerst.', fieldErrors: { confirmed: ['Bitte bestätige zuerst.'] } };
  }
  const { token } = await requireUser(`${PAGE}/${id}`);
  try {
    if (op === 'delete') await api(`/me/projects/${id}`, { method: 'DELETE', token });
    else await api(`/me/projects/${id}/${op}`, { method: 'POST', token, body: op === 'publish' ? { confirmed: true } : undefined });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(PAGE);
  revalidatePath('/dienstleistungen/projekte');
  redirect(op === 'delete' ? `${PAGE}?hinweis=${OP_NOTES[op]}` : `${PAGE}/${id}?hinweis=${OP_NOTES[op]}`);
}
