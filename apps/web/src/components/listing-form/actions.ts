'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  categoryAttributeSchema,
  createListingSchema,
  parseEuroInputToCents,
  parseListingAttributes,
  missingRequiredAttributes,
  readAttributeForm,
  updateListingSchema,
  type ListingDetail,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { findCategory, getCategories } from '@/lib/data';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const TEXT_FIELDS = ['title', 'description', 'categoryId', 'priceType', 'price', 'condition', 'postalCode', 'locationId'] as const;

async function readForm(formData: FormData) {
  const values = Object.fromEntries(TEXT_FIELDS.map((f) => [f, String(formData.get(f) ?? '').trim()])) as Record<string, string>;
  // Zusatzfelder nach der Kategorie lesen, die tatsächlich abgeschickt wurde – nicht nach dem, was der Browser zeigt.
  const category = values.categoryId ? findCategory(await getCategories(), values.categoryId) : undefined;
  const schema = categoryAttributeSchema(category?.path);
  const form = readAttributeForm(schema, (name) => formData.getAll(name).map(String));
  const checked = parseListingAttributes(schema, form.attributes);
  for (const [key, raw] of Object.entries(form.raw)) values[`attributes.${key}`] = raw;

  const hasPrice = schema.price !== 'none';
  const priceCents = hasPrice && values.price ? parseEuroInputToCents(values.price) : null;
  const input = {
    title: values.title,
    description: values.description || undefined,
    categoryId: values.categoryId || undefined,
    priceType: (hasPrice ? values.priceType : 'ON_REQUEST') || undefined,
    priceCents: priceCents ?? undefined,
    condition: (schema.itemCondition && values.condition) || null,
    locationId: values.locationId ? Number(values.locationId) : undefined,
    attributes: checked.attributes,
  };
  const fieldErrors = zodFieldErrors(
    [...form.issues, ...checked.issues].map((issue) => ({ path: issue.path.split('.'), message: issue.message })),
  );
  if (hasPrice && values.price && priceCents === null) fieldErrors.price = ['Bitte gib einen gültigen Betrag ein, z. B. 49,90.'];
  // Fehlende Pflichtangaben gleich mit den übrigen Feldfehlern melden, nicht erst nach der nächsten Runde
  const missing = missingRequiredAttributes(schema, checked.attributes).map((issue) => ({ path: issue.path.split('.'), message: issue.message }));
  return { values, input, missing, fieldErrors: Object.keys(fieldErrors).length ? fieldErrors : null };
}

function errorState(error: unknown, values: Record<string, string>): FormState {
  if (error instanceof ApiError) {
    const fieldErrors = error.fieldErrors();
    if (fieldErrors.priceCents) fieldErrors.price = fieldErrors.priceCents;
    return { status: 'error', message: error.message, fieldErrors, values };
  }
  throw error;
}

/** Neues Inserat: „Veröffentlichen“ prüft alles, „Als Entwurf speichern“ nur den Titel. */
export async function createListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireUser('/inserieren');
  const publish = formData.get('intent') === 'publish';
  const { values, input, missing, fieldErrors } = await readForm(formData);
  if (fieldErrors) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors, values };

  const clientRequestId = String(formData.get('clientRequestId') ?? '') || undefined;
  const parsed = createListingSchema.safeParse({ ...input, publish, clientRequestId });
  if (!parsed.success) {
    const fieldErrors = zodFieldErrors([...parsed.error.issues, ...(publish ? missing : [])]);
    if (fieldErrors.priceCents) fieldErrors.price = fieldErrors.priceCents;
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors, values };
  }

  let listing: ListingDetail;
  try {
    listing = await api<ListingDetail>('/listings', { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return errorState(error, values);
  }
  updateTag('listings');
  // Nächster Schritt: Bilder hinzufügen (die Seite führt danach dorthin weiter, wo es sonst hinginge)
  // Nach einer Wiederholung kann das Inserat schon als Entwurf bestehen – daher nach dem gespeicherten Stand
  redirect(`/anzeige/${listing.id}/bilder?neu=${listing.status === 'ACTIVE' ? 'veroeffentlicht' : 'entwurf'}`);
}

/** Bestehendes Inserat speichern und optional (erneut) veröffentlichen. */
export async function updateListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const { token } = await requireUser(`/anzeige/${id}/bearbeiten`);
  const publish = formData.get('intent') === 'publish';
  const { values, input, fieldErrors } = await readForm(formData);
  if (fieldErrors) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors, values };

  const parsed = updateListingSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  }
  try {
    await api(`/listings/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: parsed.data });
    if (publish) await api(`/listings/${encodeURIComponent(id)}/publish`, { method: 'POST', token });
  } catch (error) {
    return errorState(error, values);
  }
  updateTag('listings');
  redirect(`/anzeige/${id}?hinweis=${publish ? 'veroeffentlicht' : 'gespeichert'}`);
}
