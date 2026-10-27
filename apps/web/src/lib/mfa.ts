import 'server-only';
import { AUTH_ERROR_CODES, totpCodeSchema } from '@marktat/shared';
import { ApiError } from './api';
import { authErrorMessage } from './auth-errors';
import { createSupabaseServerClient } from './supabase/server';

/** Name des Formularfelds für den Bestätigungscode kritischer Aktionen */
export const STEP_UP_FIELD = 'mfaCode';

export interface Assurance {
  current: 'aal1' | 'aal2' | null;
  /** aal2 = das Konto hat einen bestätigten zweiten Faktor */
  next: 'aal1' | 'aal2' | null;
}

/** Sicherheitsniveau der Sitzung (aus dem Sitzungs-Cookie, ohne Netzwerkaufruf). Die API prüft unabhängig davon selbst. */
export async function getAssurance(): Promise<Assurance> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { current: (data?.currentLevel as Assurance['current']) ?? null, next: (data?.nextLevel as Assurance['next']) ?? null };
}

/** Angemeldet, aber der zweite Faktor fehlt noch */
export function needsSecondFactor(assurance: Assurance): boolean {
  return assurance.next === 'aal2' && assurance.current !== 'aal2';
}

/**
 * Bestätigt einen TOTP-Code mit dem ersten bestätigten Faktor und gibt das neue Access-Token (aal2, frischer
 * Zeitstempel) zurück. Supabase begrenzt Fehlversuche serverseitig.
 */
export async function verifyTotp(rawCode: string): Promise<{ token: string } | { error: string }> {
  const parsed = totpCodeSchema.safeParse(rawCode);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const supabase = await createSupabaseServerClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: authErrorMessage(listError) };
  const factor = factors.totp[0];
  if (!factor) return { error: 'Für dein Konto ist keine Zwei-Faktor-Anmeldung eingerichtet.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data });
  if (error) return { error: authErrorMessage(error) };
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { error: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' };
  return { token: data.session.access_token };
}

/**
 * Für kritische Admin-Aktionen: Wurde ein Code eingegeben, wird er zuerst bestätigt und das frische Token
 * verwendet. Ohne Code bleibt es beim bisherigen Token – die API entscheidet, ob eine Bestätigung nötig ist.
 */
export async function stepUpToken(formData: FormData, token: string): Promise<{ token: string } | { fieldError: string }> {
  const code = String(formData.get(STEP_UP_FIELD) ?? '').trim();
  if (!code) return { token };
  const result = await verifyTotp(code);
  return 'error' in result ? { fieldError: result.error } : result;
}

/** Die API verlangt eine (erneute) Bestätigung mit dem zweiten Faktor */
export function isStepUpError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.body.code === AUTH_ERROR_CODES.stepUpRequired || error.body.code === AUTH_ERROR_CODES.mfaRequired)
  );
}

/** Formularzustand, wenn die API eine Bestätigung verlangt: Meldung direkt am Code-Feld */
export function stepUpFailure(error: unknown, values?: Record<string, string>) {
  if (!isStepUpError(error)) return null;
  return {
    status: 'error' as const,
    message: error.message,
    fieldErrors: { [STEP_UP_FIELD]: [error.message] },
    values,
  };
}

export function stepUpCodeError(message: string, values?: Record<string, string>) {
  return { status: 'error' as const, message, fieldErrors: { [STEP_UP_FIELD]: [message] }, values };
}
