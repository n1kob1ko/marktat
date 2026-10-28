'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAustrianPostalCode, parseEuroInputToCents, portfolioItemSchema, type LocationSummary, qualificationSchema, serviceProfileSchema } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;
const PAGE = '/konto/dienstleistungen';
const CHECK = 'Bitte prüfe die markierten Felder.';

const TEXT_FIELDS = [
  'headline',
  'summary',
  'description',
  'skills',
  'serviceRadiusKm',
  'priceType',
  'price',
  'experienceYears',
  'website',
  'availability',
  'availabilityNote',
] as const;

const optionalInt = (value: string) => (value.trim() === '' ? null : Number.isInteger(Number(value)) ? Number(value) : Number.NaN);

/** Formularwerte → API-Felder (Euro → Cent, Fähigkeiten mit Komma getrennt, Ort aus der PLZ-Suche) */
function readProfile(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of TEXT_FIELDS) {
    const value = formData.get(key);
    if (typeof value === 'string') values[key] = value;
  }
  const categorySlugs = formData.getAll('categorySlugs').map(String);
  values.categorySlugs = categorySlugs.join(',');
  values.austriaWide = formData.get('austriaWide') === 'on' ? 'on' : '';
  values.remote = formData.get('remote') === 'on' ? 'on' : '';
  values.locationId = String(formData.get('ort') ?? '');

  const fieldErrors: Record<string, string[]> = {};
  const priceCents = values.price ? parseEuroInputToCents(values.price) : null;
  if (values.priceType !== 'ON_REQUEST' && values.price && priceCents === null) fieldErrors.price = ['Bitte gib einen gültigen Betrag ein, z. B. 65 oder 49,90.'];
  const experienceYears = optionalInt(values.experienceYears ?? '');
  if (Number.isNaN(experienceYears)) fieldErrors.experienceYears = ['Bitte gib eine ganze Zahl ein.'];
  const serviceRadiusKm = optionalInt(values.serviceRadiusKm ?? '');
  if (Number.isNaN(serviceRadiusKm)) fieldErrors.serviceRadiusKm = ['Bitte gib eine ganze Zahl ein.'];

  const input = {
    headline: values.headline ?? '',
    summary: values.summary ?? '',
    description: values.description ?? '',
    categorySlugs,
    skills: (values.skills ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    locationId: Number(values.locationId) || null,
    serviceRadiusKm: Number.isNaN(serviceRadiusKm) ? null : serviceRadiusKm,
    austriaWide: values.austriaWide === 'on',
    remote: values.remote === 'on',
    priceType: values.priceType || undefined,
    priceCents: values.priceType === 'ON_REQUEST' ? null : priceCents,
    experienceYears: Number.isNaN(experienceYears) ? null : experienceYears,
    website: values.website ?? '',
    availability: values.availability || 'AVAILABLE',
    availabilityNote: values.availabilityNote ?? '',
  };
  return { input, values, fieldErrors };
}

/** API-Feldnamen → Formularfeldnamen */
function mapErrors(errors: Record<string, string[] | undefined>) {
  const map: Record<string, string> = { priceCents: 'price' };
  const result: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) {
    const field = key.startsWith('skills') ? 'skills' : key.startsWith('categorySlugs') ? 'categorySlugs' : (map[key] ?? key);
    (result[field] ??= []).push(...(messages ?? []));
  }
  return result;
}

export async function saveServiceProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireUser(PAGE);
  const { input, values, fieldErrors } = readProfile(formData);
  // Nur eine PLZ eingetippt, aber keinen Vorschlag gewählt: Ort zur PLZ nachschlagen
  const postalCode = String(formData.get('plz') ?? '').trim();
  if (!input.locationId && isAustrianPostalCode(postalCode)) {
    const matches = await api<LocationSummary[]>(`/geo/locations?q=${postalCode}`).catch(() => []);
    const match = matches.find((l) => l.postalCode === postalCode);
    if (match) input.locationId = match.id;
    else fieldErrors.locationId = ['Diese PLZ kennen wir nicht. Bitte wähle einen Ort aus der Liste.'];
  }
  if (Object.keys(fieldErrors).length) return { status: 'error', message: CHECK, fieldErrors, values };
  const parsed = serviceProfileSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: mapErrors(zodFieldErrors(parsed.error.issues)), values };
  try {
    await api(`/me/service-profile`, { method: 'PUT', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: mapErrors(error.fieldErrors()), values };
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?hinweis=anbieter-gespeichert`);
}

const OPS = { publish: 'publish', pause: 'pause', resume: 'resume', resubmit: 'resubmit' } as const;
const OP_NOTES: Record<keyof typeof OPS | 'delete', string> = {
  publish: 'anbieter-veroeffentlicht',
  pause: 'anbieter-pausiert',
  resume: 'anbieter-fortgesetzt',
  resubmit: 'anbieter-eingereicht',
  delete: 'anbieter-geloescht',
};

/** Statuswechsel des eigenen Profils (Knöpfe mit name="op"); Veröffentlichen und Löschen brauchen eine Bestätigung. */
export async function serviceProfileOpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const op = String(formData.get('op') ?? '') as keyof typeof OPS | 'delete';
  if (!(op in OP_NOTES)) return { status: 'error', message: 'Die Anfrage ist ungültig. Bitte lade die Seite neu.' };
  const confirmed = formData.get('confirmed') === 'on';
  if ((op === 'publish' || op === 'delete') && !confirmed) {
    return { status: 'error', message: 'Bitte bestätige zuerst.', fieldErrors: { confirmed: ['Bitte bestätige zuerst.'] } };
  }
  const { token } = await requireUser(PAGE);
  try {
    if (op === 'delete') await api('/me/service-profile', { method: 'DELETE', token });
    else await api(`/me/service-profile/${OPS[op]}`, { method: 'POST', token, body: op === 'publish' ? { confirmed: true } : undefined });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(PAGE);
  revalidatePath('/dienstleistungen');
  redirect(`${PAGE}?hinweis=${OP_NOTES[op]}`);
}

export async function savePortfolioItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (id && !ENTITY_ID.test(id)) return { status: 'error', message: 'Diesen Eintrag gibt es nicht.' };
  const values = {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    categorySlug: String(formData.get('categorySlug') ?? ''),
    url: String(formData.get('url') ?? ''),
  };
  const parsed = portfolioItemSchema.safeParse({ ...values, categorySlug: values.categorySlug || null });
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser(PAGE);
  let itemId = id;
  try {
    if (id) await api(`/me/service-profile/portfolio/${id}`, { method: 'PATCH', token, body: parsed.data });
    else itemId = (await api<{ id: string }>('/me/service-profile/portfolio', { method: 'POST', token, body: parsed.data })).id;
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  revalidatePath(PAGE);
  // Nach dem Anlegen direkt zum Eintrag, damit gleich ein Bild hochgeladen werden kann
  redirect(`${PAGE}?hinweis=portfolio-gespeichert&eintrag=${itemId}#portfolio-${itemId}`);
}

export async function deletePortfolioItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return { status: 'error', message: 'Diesen Eintrag gibt es nicht.' };
  const { token } = await requireUser(PAGE);
  try {
    await api(`/me/service-profile/portfolio/${id}`, { method: 'DELETE', token });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?hinweis=portfolio-geloescht#portfolio`);
}

export async function addQualificationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    title: String(formData.get('title') ?? ''),
    issuer: String(formData.get('issuer') ?? ''),
    reference: String(formData.get('reference') ?? ''),
  };
  const parsed = qualificationSchema.safeParse(values);
  if (!parsed.success) return { status: 'error', message: CHECK, fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const { token } = await requireUser(PAGE);
  try {
    await api('/me/service-profile/qualifications', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?hinweis=qualifikation-gespeichert#qualifikationen`);
}

export async function deleteQualificationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return { status: 'error', message: 'Diese Qualifikation gibt es nicht.' };
  const { token } = await requireUser(PAGE);
  try {
    await api(`/me/service-profile/qualifications/${id}`, { method: 'DELETE', token });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?hinweis=qualifikation-geloescht#qualifikationen`);
}
