'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  appealDecisionSchema,
  assignDealMerchantSchema,
  changeRoleSchema,
  dealFeedReviewSchema,
  dealsBlockSchema,
  dismissReportSchema,
  listingDecisionSchema,
  portfolioItemDecisionSchema,
  qualificationReviewSchema,
  reportingRestrictionSchema,
  updateReportSchema,
  userDecisionSchema,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID, UUID } from '@/lib/admin';
import { zodFieldErrors, type FormState } from '@/lib/form-state';
import { stepUpCodeError, stepUpFailure, stepUpToken } from '@/lib/mfa';

/**
 * Aktionen im Admin-Bereich. Die Web-App prüft nur Form und IDs; ob jemand die Aktion ausführen darf,
 * entscheidet ausschließlich die API anhand der Rolle in der Datenbank.
 */

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function values(formData: FormData, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function failure(error: unknown, kept?: Record<string, string>): FormState {
  const stepUp = stepUpFailure(error, kept);
  if (stepUp) return stepUp;
  if (error instanceof ApiError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors(), values: kept };
  throw error;
}

const invalid: FormState = { status: 'error', message: 'Die Anfrage ist ungültig. Bitte lade die Seite neu.' };

// --- Meldungen ------------------------------------------------------------------

export async function updateReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const parsed = updateReportSchema.safeParse({
    priority: text(formData, 'priority'),
    assign: text(formData, 'assign'),
    note: text(formData, 'note'),
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Bitte prüfe die Eingabe.' };
  const { token } = await requireStaff(`/admin/meldungen/${id}`);
  try {
    await api(`/admin/reports/${id}`, { method: 'PATCH', token, body: parsed.data });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/meldungen/${id}`);
  return {
    status: 'success',
    message: parsed.data.assign === 'me' ? 'Du bearbeitest diese Meldung.' : parsed.data.assign === 'none' ? 'Die Meldung ist wieder frei.' : 'Gespeichert.',
  };
}

export async function dismissReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, ['note']);
  const parsed = dismissReportSchema.safeParse({ note: text(formData, 'note'), abusive: formData.get('abusive') === 'on' });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die Eingabe.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  const { token } = await requireStaff(`/admin/meldungen/${id}`);
  try {
    await api(`/admin/reports/${id}/dismiss`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  // Weiterleitung statt Rückmeldung im Formular: das Formular verschwindet mit dem neuen Status
  redirect(`/admin/meldungen/${id}?hinweis=mod-geschlossen`);
}

// --- Entscheidungen -------------------------------------------------------------

const DECISION_FIELDS = ['decision', 'reason', 'ground', 'statement', 'internalNote'];

export async function decideListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = listingDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
    version: text(formData, 'version'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'RESTORE') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const { token } = await requireStaff(`/admin/inserate/${id}`);
  try {
    await api(`/admin/listings/${id}/decisions`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('listings');
  redirect(`/admin/inserate/${id}?hinweis=${parsed.data.decision === 'RESTORE' ? 'mod-freigegeben' : 'mod-entschieden'}`);
}

export async function decideDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = listingDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
    version: text(formData, 'version'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'RESTORE') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const { token } = await requireStaff(`/admin/deals/${id}`);
  try {
    await api(`/admin/deals/${id}/decisions`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('deals');
  redirect(`/admin/deals/${id}?hinweis=${parsed.data.decision === 'RESTORE' ? 'mod-deal-freigegeben' : 'mod-deal-entschieden'}`);
}

export async function decideServiceProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = listingDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
    version: text(formData, 'version'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'RESTORE') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const { token } = await requireStaff(`/admin/dienstleistungen/${id}`);
  try {
    await api(`/admin/services/${id}/decisions`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  revalidatePath('/dienstleistungen');
  redirect(`/admin/dienstleistungen/${id}?hinweis=${parsed.data.decision === 'RESTORE' ? 'mod-anbieter-freigegeben' : 'mod-anbieter-entschieden'}`);
}

/** Einzelnen Portfolio-Eintrag ausblenden bzw. wieder zeigen; zurück geht es zum Profil (verstecktes Feld profileId) */
export async function decidePortfolioItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  if (!ENTITY_ID.test(id) || !ENTITY_ID.test(profileId)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = portfolioItemDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'RESTORE') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const { token } = await requireStaff(`/admin/dienstleistungen/${profileId}`);
  try {
    await api(`/admin/service-portfolio/${id}/decisions`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  redirect(`/admin/dienstleistungen/${profileId}?hinweis=${parsed.data.decision === 'RESTORE' ? 'mod-portfolio-freigegeben' : 'mod-portfolio-ausgeblendet'}`);
}

/** Qualifikation prüfen: bestätigen („Von MarktAT geprüft“) oder nicht bestätigen */
export async function reviewQualificationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  if (!ENTITY_ID.test(id) || !ENTITY_ID.test(profileId)) return invalid;
  const kept = values(formData, ['note']);
  const parsed = qualificationReviewSchema.safeParse({ decision: text(formData, 'decision'), note: text(formData, 'note') });
  if (!parsed.success) return { status: 'error', message: 'Bitte wähle ein Ergebnis.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  const { token } = await requireStaff(`/admin/dienstleistungen/${profileId}`);
  try {
    await api(`/admin/service-qualifications/${id}/review`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  redirect(`/admin/dienstleistungen/${profileId}?hinweis=qualifikation-geprueft`);
}

/** Konto für Deals sperren (Moderation) bzw. Sperre aufheben (nur Administratoren, prüft die API) */
export async function dealsBlockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = dealsBlockSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'UNBLOCK') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const session = await requireStaff(`/admin/nutzer/${id}`);
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, kept);
  try {
    await api(`/admin/users/${id}/deals-block`, { method: 'POST', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('deals');
  redirect(`/admin/nutzer/${id}?hinweis=${parsed.data.decision === 'BLOCK' ? 'mod-deals-gesperrt' : 'mod-deals-entsperrt'}`);
}

/** Deal einem anderen gewerblichen Konto zuordnen (nur Administratoren, prüft die API) */
export async function assignDealMerchantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, ['merchantId', 'note']);
  const parsed = assignDealMerchantSchema.safeParse({ merchantId: (text(formData, 'merchantId') ?? '').trim(), note: String(formData.get('note') ?? '') });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  const session = await requireStaff(`/admin/deals/${id}`);
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, kept);
  try {
    await api(`/admin/deals/${id}/merchant`, { method: 'PUT', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('deals');
  redirect(`/admin/deals/${id}?hinweis=deal-haendler-geaendert`);
}

export async function decideUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  const kept = values(formData, DECISION_FIELDS);
  const parsed = userDecisionSchema.safeParse({
    decision: text(formData, 'decision'),
    reason: text(formData, 'reason'),
    ground: text(formData, 'ground'),
    statement: String(formData.get('statement') ?? ''),
    internalNote: text(formData, 'internalNote'),
    reportId: text(formData, 'reportId'),
  });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  if (parsed.data.decision === 'RESTORE') {
    delete parsed.data.reason;
    delete parsed.data.ground;
  }
  const session = await requireStaff(`/admin/nutzer/${id}`);
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError, kept);
  try {
    await api(`/admin/users/${id}/decisions`, { method: 'POST', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('listings');
  redirect(`/admin/nutzer/${id}?hinweis=${parsed.data.decision === 'SUSPEND' ? 'mod-gesperrt' : 'mod-entsperrt'}`);
}

export async function decideAppealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, ['outcome', 'response']);
  const parsed = appealDecisionSchema.safeParse({ outcome: text(formData, 'outcome'), response: String(formData.get('response') ?? '') });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die markierten Felder.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  const { token } = await requireStaff(`/admin/einsprueche/${id}`);
  try {
    await api(`/admin/appeals/${id}/decision`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  updateTag('listings');
  redirect(`/admin/einsprueche/${id}?hinweis=mod-einspruch`);
}

// --- Konten (nur Administratoren, prüft die API) --------------------------------

export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  const parsed = changeRoleSchema.safeParse({ role: text(formData, 'role') });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ungültige Rolle.' };
  const session = await requireStaff(`/admin/nutzer/${id}`);
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError);
  try {
    await api(`/admin/users/${id}/role`, { method: 'PUT', token: auth.token, body: parsed.data });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/nutzer/${id}`);
  return { status: 'success', message: parsed.data.role === 'MODERATOR' ? 'Das Konto hat jetzt Moderationsrechte.' : 'Die Moderationsrechte sind entzogen.' };
}

export async function restrictReportingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  const parsed = reportingRestrictionSchema.safeParse({ days: Number(formData.get('days') ?? -1), note: text(formData, 'note') });
  if (!parsed.success) return { status: 'error', message: 'Bitte wähle einen Zeitraum zwischen 0 und 365 Tagen.' };
  const { token } = await requireStaff(`/admin/nutzer/${id}`);
  try {
    await api(`/admin/users/${id}/reporting`, { method: 'PUT', token, body: parsed.data });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/nutzer/${id}`);
  return { status: 'success', message: parsed.data.days ? `Die Meldefunktion ist für ${parsed.data.days} Tage eingeschränkt.` : 'Die Einschränkung ist aufgehoben.' };
}

export async function retryDeletionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  const { token } = await requireStaff(`/admin/nutzer/${id}`);
  try {
    await api(`/admin/deletions/${id}/retry`, { method: 'POST', token });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/nutzer/${id}`);
  return { status: 'success', message: 'Die Löschung wurde erneut gestartet.' };
}

/** 2FA eines anderen Kontos zurücksetzen (z. B. Gerät verloren) – kritische Aktion mit Bestätigungscode */
export async function resetMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return invalid;
  if (formData.get('confirm') !== 'on') {
    return { status: 'error', message: 'Bitte bestätige, dass du die Identität der Person geprüft hast.', fieldErrors: { confirm: ['Bitte bestätigen.'] } };
  }
  const session = await requireStaff(`/admin/nutzer/${id}`);
  const auth = await stepUpToken(formData, session.token);
  if ('fieldError' in auth) return stepUpCodeError(auth.fieldError);
  try {
    await api(`/admin/users/${id}/mfa/reset`, { method: 'POST', token: auth.token });
  } catch (error) {
    return failure(error);
  }
  // Der Abschnitt zeigt danach „Nicht eingerichtet“ – die Bestätigung kommt als Hinweis über der Seite
  redirect(`/admin/nutzer/${id}?hinweis=2fa-zurueckgesetzt`);
}

// --- Systemzustand ----------------------------------------------------------------

export async function resolveErrorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!/^\d{1,18}$/.test(id)) return invalid;
  const { token } = await requireStaff('/admin/system');
  try {
    await api(`/admin/system/errors/${id}`, { method: 'DELETE', token });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/admin/system');
  return { status: 'success' };
}

// --- Produktfeeds -----------------------------------------------------------------

export async function reviewDealFeedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  if (!ENTITY_ID.test(id)) return invalid;
  const kept = values(formData, ['note']);
  const parsed = dealFeedReviewSchema.safeParse({ decision: text(formData, 'decision'), note: text(formData, 'note') });
  if (!parsed.success) return { status: 'error', message: 'Bitte prüfe die Angaben.', fieldErrors: zodFieldErrors(parsed.error.issues), values: kept };
  const { token } = await requireStaff('/admin/deals/feeds');
  try {
    await api(`/admin/deal-feeds/${id}/review`, { method: 'POST', token, body: parsed.data });
  } catch (error) {
    return failure(error, kept);
  }
  revalidatePath('/admin/deals/feeds');
  return { status: 'success', message: 'Gespeichert.' };
}
