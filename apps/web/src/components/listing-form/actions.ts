'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createListingSchema,
  parseEuroInputToCents,
  updateListingSchema,
  type ListingDetail,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';

const TEXT_FIELDS = ['title', 'description', 'categoryId', 'priceType', 'price', 'condition', 'postalCode', 'locationId'] as const;

function readForm(formData: FormData) {
  const values = Object.fromEntries(TEXT_FIELDS.map((f) => [f, String(formData.get(f) ?? '').trim()])) as Record<
    (typeof TEXT_FIELDS)[number],
    string
  >;
  const priceCents = values.price ? parseEuroInputToCents(values.price) : null;
  const input = {
    title: values.title,
    description: values.description || undefined,
    categoryId: values.categoryId || undefined,
    priceType: values.priceType || undefined,
    priceCents: priceCents ?? undefined,
    condition: values.condition || null,
    locationId: values.locationId ? Number(values.locationId) : undefined,
  };
  const priceInvalid = Boolean(values.price) && priceCents === null;
  return { values, input, priceInvalid };
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
  const { values, input, priceInvalid } = readForm(formData);
  if (priceInvalid) return { status: 'error', fieldErrors: { price: ['Bitte gib einen gültigen Betrag ein, z. B. 49,90.'] }, values };

  const parsed = createListingSchema.safeParse({ ...input, publish });
  if (!parsed.success) {
    const fieldErrors = zodFieldErrors(parsed.error.issues);
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
  redirect(`/anzeige/${listing.id}/bilder?neu=${publish ? 'veroeffentlicht' : 'entwurf'}`);
}

/** Bestehendes Inserat speichern und optional (erneut) veröffentlichen. */
export async function updateListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const { token } = await requireUser(`/anzeige/${id}/bearbeiten`);
  const publish = formData.get('intent') === 'publish';
  const { values, input, priceInvalid } = readForm(formData);
  if (priceInvalid) return { status: 'error', fieldErrors: { price: ['Bitte gib einen gültigen Betrag ein, z. B. 49,90.'] }, values };

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
