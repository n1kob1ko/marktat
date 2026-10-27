'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { createDealSchema, dealerStoreSchema, extendDealSchema, parseDayInput, parseEuroInputToCents, updateDealSchema, type DealDetail } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;

const DEAL_FORM_FIELDS = [
  'title',
  'description',
  'categorySlug',
  'channel',
  'url',
  'price',
  'unitPriceText',
  'shippingNote',
  'referenceType',
  'referencePrice',
  'referencePriceSource',
  'referencePriceEvidenceUrl',
  'availability',
  'startsOn',
  'endsOn',
  'brand',
  'gtin',
  'externalId',
] as const;

function read(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of DEAL_FORM_FIELDS) {
    const value = formData.get(key);
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/** Formularwerte → API-Felder (Euro → Cent, Datum d.m.yyyy → yyyy-mm-dd, Vergleichspreis nur mit Grundlage) */
function toInput(formData: FormData, values: Record<string, string>) {
  const fieldErrors: Record<string, string[]> = {};
  const priceCents = values.price ? parseEuroInputToCents(values.price) : null;
  if (values.price && priceCents === null) fieldErrors.price = ['Bitte gib einen gültigen Betrag ein, z. B. 49,90.'];
  const referenceType = values.referenceType === 'RRP' || values.referenceType === 'LOWEST_30_DAYS' ? values.referenceType : null;
  const referenceCents = referenceType && values.referencePrice ? parseEuroInputToCents(values.referencePrice) : null;
  if (referenceType && values.referencePrice && referenceCents === null) fieldErrors.referencePrice = ['Bitte gib einen gültigen Betrag ein, z. B. 79,90.'];
  if (referenceType && !values.referencePrice) fieldErrors.referencePrice = ['Bitte gib den Vergleichspreis an oder wähle „Kein Vergleichspreis“.'];
  const channel = values.channel;
  const input = {
    title: values.title ?? '',
    description: values.description ?? '',
    categorySlug: values.categorySlug ?? '',
    channel,
    url: channel === 'LOCAL' ? (values.url || null) : values.url || null,
    isAffiliateLink: channel !== 'LOCAL' && formData.get('isAffiliateLink') === 'on',
    priceCents: priceCents ?? undefined,
    unitPriceText: values.unitPriceText ?? '',
    shippingNote: values.shippingNote ?? '',
    referencePriceCents: referenceCents,
    referencePriceType: referenceType,
    referencePriceSource: referenceType ? (values.referencePriceSource ?? '') : '',
    referencePriceEvidenceUrl: referenceType ? values.referencePriceEvidenceUrl || null : null,
    referenceConfirmed: referenceType ? formData.get('referenceConfirmed') === 'on' : undefined,
    availability: values.availability || 'UNKNOWN',
    startsOn: parseDayInput(values.startsOn ?? '') ?? values.startsOn ?? '',
    endsOn: parseDayInput(values.endsOn ?? '') ?? values.endsOn ?? '',
    storeIds: channel === 'ONLINE' ? [] : formData.getAll('storeIds').map(String).filter((id) => ENTITY_ID.test(id)),
    brand: values.brand ?? '',
    gtin: values.gtin ?? '',
    externalId: values.externalId ?? '',
  };
  return { input, fieldErrors };
}

/** API-Feldnamen → Formularfeldnamen */
function mapErrors(errors: Record<string, string[]>) {
  const map: Record<string, string> = { priceCents: 'price', referencePriceCents: 'referencePrice', referencePriceType: 'referenceType' };
  const result: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) (result[map[key] ?? key] ??= []).push(...messages);
  return result;
}

const CHECK = 'Bitte prüfe die markierten Felder.';

export async function saveDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const intent = formData.get('intent') === 'publish' ? 'publish' : 'save';
  const { token } = await requireUser(id ? `/konto/deals/${id}` : '/konto/deals/neu');
  const values = read(formData);
  const { input, fieldErrors } = toInput(formData, values);
  if (Object.keys(fieldErrors).length) return { status: 'error', message: CHECK, fieldErrors, values };

  let saved: DealDetail;
  try {
    if (!id) {
      const parsed = createDealSchema.safeParse({ ...input, publish: intent === 'publish', clientRequestId: String(formData.get('clientRequestId') ?? '') || undefined });
      if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: mapErrors(zodFieldErrors(parsed.error.issues)), values };
      saved = await api<DealDetail>('/me/deals', { method: 'POST', token, body: parsed.data });
    } else {
      if (!ENTITY_ID.test(id)) return { status: 'error', message: 'Dieses Angebot gibt es nicht.' };
      const parsed = updateDealSchema.safeParse(input);
      if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: mapErrors(zodFieldErrors(parsed.error.issues)), values };
      saved = await api<DealDetail>(`/me/deals/${id}`, { method: 'PATCH', token, body: parsed.data });
      if (intent === 'publish' && saved.status === 'DRAFT') saved = await api<DealDetail>(`/me/deals/${id}/publish`, { method: 'POST', token });
    }
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: mapErrors(error.fieldErrors()), values };
    throw error;
  }
  updateTag('deals');
  revalidatePath('/konto/deals');
  redirect(`/konto/deals/${saved.id}?hinweis=${saved.status === 'DRAFT' ? 'deal-entwurf' : saved.status === 'PENDING_REVIEW' ? 'deal-pruefung' : 'deal-gespeichert'}`);
}

const OPS = { publish: 'publish', pause: 'pause', resume: 'resume', verify: 'verify', resubmit: 'resubmit' } as const;
const OP_NOTES: Record<keyof typeof OPS | 'delete', string> = {
  publish: 'deal-gespeichert',
  pause: 'deal-pausiert',
  resume: 'deal-fortgesetzt',
  verify: 'deal-bestaetigt',
  resubmit: 'deal-eingereicht',
  delete: 'deal-geloescht',
};

/** Aktionen aus der Liste und der Detailseite (Knöpfe mit name="op") */
export async function dealOpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const op = String(formData.get('op') ?? '') as keyof typeof OPS | 'delete';
  const back = formData.get('back') === 'list' ? '/konto/deals' : `/konto/deals/${id}`;
  if (!ENTITY_ID.test(id) || !(op in OP_NOTES)) return { status: 'error', message: 'Die Anfrage ist ungültig. Bitte lade die Seite neu.' };
  const { token } = await requireUser(back);
  try {
    if (op === 'delete') await api(`/me/deals/${id}`, { method: 'DELETE', token });
    else await api(`/me/deals/${id}/${OPS[op]}`, { method: 'POST', token });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  updateTag('deals');
  revalidatePath('/konto/deals');
  redirect(`${op === 'delete' ? '/konto/deals' : back}?hinweis=${OP_NOTES[op]}`);
}

export async function extendDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return { status: 'error', message: 'Dieses Angebot gibt es nicht.' };
  const raw = String(formData.get('endsOn') ?? '');
  const parsed = extendDealSchema.safeParse({ endsOn: parseDayInput(raw) ?? raw });
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: zodFieldErrors(parsed.error.issues), values: { endsOn: raw } };
  const { token } = await requireUser(`/konto/deals/${id}`);
  try {
    await api(`/me/deals/${id}/extend`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values: { endsOn: raw } };
    throw error;
  }
  updateTag('deals');
  redirect(`/konto/deals/${id}?hinweis=deal-verlaengert`);
}

export async function certifyDealerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get('confirmed') !== 'on') return { status: 'error', message: 'Bitte bestätige die Angaben.', fieldErrors: { confirmed: ['Bitte bestätige die Angaben.'] } };
  const { token } = await requireUser('/konto/deals');
  try {
    await api('/me/dealer-certification', { method: 'POST', token, body: { confirmed: true } });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  // Weiterleitung statt Rückmeldung im Formular: nach der Bestätigung verschwindet das Formular
  redirect('/konto/deals?hinweis=haendler-bestaetigt');
}

export async function saveStoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const values = {
    name: String(formData.get('name') ?? ''),
    street: String(formData.get('street') ?? ''),
    // Ort aus der PLZ-Suche (verstecktes Feld „ort“)
    locationId: String(formData.get('locationId') ?? formData.get('ort') ?? ''),
    openingHours: String(formData.get('openingHours') ?? ''),
  };
  const parsed = dealerStoreSchema.safeParse({ ...values, locationId: Number(values.locationId) || undefined });
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser('/konto/deals/filialen');
  try {
    if (id && ENTITY_ID.test(id)) await api(`/me/stores/${id}`, { method: 'PUT', token, body: parsed.data });
    else await api('/me/stores', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  updateTag('deals');
  redirect(`/konto/deals/filialen?hinweis=${id ? 'filiale-gespeichert' : 'filiale-angelegt'}`);
}

export async function deleteStoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return { status: 'error', message: 'Diese Filiale gibt es nicht.' };
  const { token } = await requireUser('/konto/deals/filialen');
  try {
    await api(`/me/stores/${id}`, { method: 'DELETE', token });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  updateTag('deals');
  redirect('/konto/deals/filialen?hinweis=filiale-geloescht');
}
