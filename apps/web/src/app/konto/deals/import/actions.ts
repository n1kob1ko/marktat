'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { DEAL_FEED_FORMATS, DEAL_IMPORT_FIELD_KEYS, dealFeedSchema, type DealFeedView, type DealImportView } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;
const invalid: FormState = { status: 'error', message: 'Die Anfrage ist ungültig. Bitte lade die Seite neu.' };

function failure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
  throw error;
}

/** Spaltenzuordnung (Felder „map_<feld>“) für eine Vorschau oder – bei einem Probeabruf – für den Feed speichern */
export async function saveMappingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const feedId = String(formData.get('feedId') ?? '');
  if (!ENTITY_ID.test(id) || (feedId && !ENTITY_ID.test(feedId))) return invalid;
  const mapping: Record<string, string> = {};
  for (const key of DEAL_IMPORT_FIELD_KEYS) {
    const value = formData.get(`map_${key}`);
    if (typeof value === 'string' && value) mapping[key] = value;
  }
  const { token } = await requireUser(`/konto/deals/import/${id}`);
  let feedPreview: string | null = null;
  try {
    if (feedId) {
      // Feed: Zuordnung am Feed speichern und mit einem neuen Probeabruf prüfen
      await api(`/me/deal-feeds/${feedId}/mapping`, { method: 'PUT', token, body: mapping });
      feedPreview = (await api<DealImportView>(`/me/deal-feeds/${feedId}/preview`, { method: 'POST', token })).id;
    } else {
      await api(`/me/deal-imports/${id}/mapping`, { method: 'PUT', token, body: mapping });
    }
  } catch (error) {
    return failure(error, mapping);
  }
  if (feedPreview) redirect(`/konto/deals/import/${feedPreview}?hinweis=feed-zuordnung`);
  revalidatePath(`/konto/deals/import/${id}`);
  return { status: 'success', message: 'Die Zuordnung ist gespeichert, die Vorschau wurde neu berechnet.' };
}

export async function commitImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const publish = formData.get('mode') !== 'draft';
  const confirmReferencePrices = formData.get('confirmReferencePrices') === 'on';
  const kept = { mode: publish ? 'publish' : 'draft' };
  if (formData.get('needsConfirmation') === '1' && !confirmReferencePrices) {
    return {
      status: 'error',
      message: 'Bitte bestätige die Vergleichspreise oder entferne sie aus der Datei.',
      fieldErrors: { confirmReferencePrices: ['Bitte bestätigen.'] },
      values: kept,
    };
  }
  const { token } = await requireUser(`/konto/deals/import/${id}`);
  try {
    await api(`/me/deal-imports/${id}/commit`, { method: 'POST', token, body: { publish, confirmReferencePrices } });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('deals');
  revalidatePath('/konto/deals');
  redirect(`/konto/deals/import/${id}?hinweis=import-uebernommen`);
}

export async function cancelImportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const { token } = await requireUser('/konto/deals/import');
  try {
    await api(`/me/deal-imports/${id}`, { method: 'DELETE', token });
  } catch (error) {
    return failure(error);
  }
  redirect('/konto/deals/import?hinweis=import-verworfen');
}

// --- Produktfeeds ------------------------------------------------------------------

const FEED_FIELDS = ['name', 'url', 'format', 'intervalHours', 'licenseNote'] as const;

export async function saveFeedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (id && !ENTITY_ID.test(id)) return invalid;
  const values: Record<string, string> = {};
  for (const key of FEED_FIELDS) values[key] = String(formData.get(key) ?? '');
  const format = DEAL_FEED_FORMATS.find((f) => f === values.format);
  const parsed = dealFeedSchema.safeParse({
    name: values.name,
    url: values.url,
    format,
    intervalHours: Number(values.intervalHours) || 0,
    licenseNote: values.licenseNote,
    licenseConfirmed: formData.get('licenseConfirmed') === 'on',
    referencePricesConfirmed: formData.get('referencePricesConfirmed') === 'on',
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser('/konto/deals/feeds');
  let feed: DealFeedView;
  try {
    feed = await api<DealFeedView>(id ? `/me/deal-feeds/${id}` : '/me/deal-feeds', { method: id ? 'PUT' : 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/konto/deals/feeds?hinweis=${feed.status === 'PENDING' ? 'feed-pruefung' : 'feed-gespeichert'}`);
}

const FEED_OPS = { pause: 'feed-pausiert', resume: 'feed-fortgesetzt', delete: 'feed-entfernt' } as const;

export async function feedOpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const op = String(formData.get('op') ?? '');
  if (!ENTITY_ID.test(id) || (op !== 'preview' && !(op in FEED_OPS))) return invalid;
  const { token } = await requireUser('/konto/deals/feeds');
  let target: string;
  try {
    if (op === 'preview') {
      const preview = await api<DealImportView>(`/me/deal-feeds/${id}/preview`, { method: 'POST', token });
      target = `/konto/deals/import/${preview.id}`;
    } else {
      if (op === 'delete') await api(`/me/deal-feeds/${id}`, { method: 'DELETE', token });
      else await api(`/me/deal-feeds/${id}/${op}`, { method: 'POST', token });
      target = `/konto/deals/feeds?hinweis=${FEED_OPS[op as keyof typeof FEED_OPS]}`;
    }
  } catch (error) {
    return failure(error);
  }
  redirect(target);
}
