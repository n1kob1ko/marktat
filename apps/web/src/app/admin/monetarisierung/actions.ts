'use server';

import { revalidatePath, updateTag } from 'next/cache';
import {
  billingModeSchema,
  parseEuroInputToCents,
  PRODUCT_CODES,
  updateBillingSettingsSchema,
  updateProductSchema,
  viennaDayStart,
  type ProductCode,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { stepUpCodeError, stepUpFailure, stepUpToken } from '@/lib/mfa';

/**
 * Preise, Einführungsaktion und Betriebsmodus. Die Web-App wandelt nur Eingaben um (Euro → Cent, Datum → Wiener
 * Tagesbeginn); Berechtigung (nur ADMIN), Prüfung, Versionskonflikte und Protokoll übernimmt die API.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function raw(formData: FormData, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** Leeres Feld = kein Wert (z. B. „ohne Limit“); sonst ganze Zahl, ungültig bleibt NaN für die Prüfung */
function optionalInt(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/** Datumsfeld (Wiener Kalendertag): Beginn = 00:00 Uhr, Ende = einschließlich des Tages, also 00:00 Uhr des Folgetags */
function day(value: string | undefined, end = false): string | null {
  if (!value?.trim()) return null;
  return DAY.test(value) ? viennaDayStart(value, end ? 1 : 0).toISOString() : 'ungültig';
}

function failure(error: unknown, values: Record<string, string>): FormState {
  const stepUp = stepUpFailure(error, values);
  if (stepUp) return stepUp;
  if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values };
  throw error;
}

function changed() {
  // Öffentliche Preise und Einführungsaktion sind zwischengespeichert
  updateTag('billing');
  revalidatePath('/admin/monetarisierung');
}

const PRODUCT_FIELDS = [
  'name', 'description', 'price', 'plannedPrice', 'durationDays', 'promoStartsAt', 'promoEndsAt',
  'maxActivePerUser', 'maxActiveTotal', 'maxPerPeriod', 'periodDays', 'cooldownHours', 'expectedUpdatedAt',
] as const;

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get('code') ?? '') as ProductCode;
  if (!PRODUCT_CODES.includes(code)) return { status: 'error', message: 'Unbekannte Leistung. Bitte lade die Seite neu.' };
  const values = raw(formData, PRODUCT_FIELDS);
  const priceCents = parseEuroInputToCents(values.price ?? '');
  const plannedPriceCents = values.plannedPrice?.trim() ? parseEuroInputToCents(values.plannedPrice) : null;
  const fieldErrors: Record<string, string[]> = {};
  if (priceCents === null) fieldErrors.price = ['Bitte gib einen Betrag ein, z. B. 0 oder 4,90.'];
  if (values.plannedPrice?.trim() && plannedPriceCents === null) fieldErrors.plannedPrice = ['Bitte gib einen gültigen Betrag ein, z. B. 2,90.'];
  if (Object.keys(fieldErrors).length) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors, values };

  const parsed = updateProductSchema.safeParse({
    name: values.name,
    description: values.description,
    priceCents,
    plannedPriceCents,
    durationDays: optionalInt(values.durationDays),
    forPrivate: formData.get('forPrivate') === 'on',
    forBusiness: formData.get('forBusiness') === 'on',
    isActive: formData.get('isActive') === 'on',
    paidEnabled: formData.get('paidEnabled') === 'on',
    promoStartsAt: day(values.promoStartsAt),
    promoEndsAt: day(values.promoEndsAt, true),
    maxActivePerUser: optionalInt(values.maxActivePerUser),
    maxActiveTotal: optionalInt(values.maxActiveTotal),
    maxPerPeriod: optionalInt(values.maxPerPeriod),
    periodDays: optionalInt(values.periodDays) ?? Number.NaN,
    cooldownHours: optionalInt(values.cooldownHours),
    expectedUpdatedAt: values.expectedUpdatedAt,
  });
  if (!parsed.success) {
    const errors = zodFieldErrors(parsed.error.issues);
    if (errors.priceCents) errors.price = errors.priceCents;
    if (errors.plannedPriceCents) errors.plannedPrice = errors.plannedPriceCents;
    return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: errors, values };
  }
  const session = await requireStaff('/admin/monetarisierung');
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, values);
  try {
    await api(`/admin/billing/products/${code}`, { method: 'PUT', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, values);
  }
  changed();
  return { status: 'success', message: 'Gespeichert. Die Änderung ist protokolliert.' };
}

const SETTINGS_FIELDS = ['introTitle', 'introDescription', 'introStartsAt', 'introEndsAt', 'maxBookingsPerHour'] as const;

export async function updateBillingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = raw(formData, SETTINGS_FIELDS);
  const parsed = updateBillingSettingsSchema.safeParse({
    introEnabled: formData.get('introEnabled') === 'on',
    introVisible: formData.get('introVisible') === 'on',
    introTitle: values.introTitle,
    introDescription: values.introDescription,
    introStartsAt: day(values.introStartsAt),
    introEndsAt: day(values.introEndsAt, true),
    introShowPlannedPrice: formData.get('introShowPlannedPrice') === 'on',
    maxBookingsPerHour: optionalInt(values.maxBookingsPerHour) ?? Number.NaN,
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const session = await requireStaff('/admin/monetarisierung');
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, values);
  try {
    await api('/admin/billing/settings', { method: 'PUT', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, values);
  }
  changed();
  return { status: 'success', message: 'Gespeichert. Die Änderung ist protokolliert.' };
}

/** Betriebsmodus: kostenpflichtig nur mit wörtlicher Bestätigung – und nur, wenn die API keine Hindernisse meldet. */
export async function setBillingModeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = raw(formData, ['mode', 'confirmation']);
  const parsed = billingModeSchema.safeParse({ mode: values.mode, ...(values.mode === 'PAID' ? { confirmation: values.confirmation ?? '' } : {}) });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die Eingabe.', fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const session = await requireStaff('/admin/monetarisierung');
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, values);
  try {
    await api('/admin/billing/mode', { method: 'PUT', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, values);
  }
  changed();
  return {
    status: 'success',
    message: parsed.data.mode === 'PAID' ? 'Der kostenpflichtige Betrieb ist eingeschaltet.' : 'Die Plattform läuft wieder kostenlos. Ab sofort wird nichts mehr verrechnet.',
  };
}
