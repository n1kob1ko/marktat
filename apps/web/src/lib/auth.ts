import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import type { MeResponse } from '@marktat/shared';
import { api, ApiError } from './api';
import { createSupabaseServerClient } from './supabase/server';

/** Je Anfrage nur einmal gelesen (Layout und Seite fragen beide) */
export const getAccessToken = cache(async (): Promise<string | null> => {
  await connection();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
});

export const getCurrentUser = cache(async (): Promise<MeResponse | null> => {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    return await api<MeResponse>('/me', {
      token,
      cache: 'no-store',
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return null;
    }
    throw error;
  }
});

/**
 * Angemeldete Person oder Weiterleitung zur Anmeldung. Gesperrte Konten landen bei ihren Entscheidungen
 * (Begründung und Einspruch), außer die Seite ist auch für sie gedacht (`allowSuspended`).
 */
export async function requireUser(
  returnTo: string,
  options: { allowSuspended?: boolean } = {}
): Promise<{ user: MeResponse; token: string }> {
  const token = await getAccessToken();
  const user = token ? await getCurrentUser() : null;

  if (!token || !user) {
    redirect(`/anmelden?weiter=${encodeURIComponent(returnTo)}`);
  }
  if (user.status === 'SUSPENDED' && !options.allowSuspended) {
    redirect('/konto/entscheidungen');
  }

  return { user, token };
}

export function isStaff(user: Pick<MeResponse, 'role' | 'status'> | null): boolean {
  return Boolean(user && user.status === 'ACTIVE' && (user.role === 'ADMIN' || user.role === 'MODERATOR'));
}

/**
 * Admin-Bereich: nur Moderation und Administration. Für alle anderen gibt es die Seite nicht (404),
 * damit der Bereich nicht auffällt. Die API prüft jede Anfrage zusätzlich selbst.
 */
export async function requireStaff(returnTo: string): Promise<{ user: MeResponse; token: string }> {
  const { user, token } = await requireUser(returnTo);
  if (!isStaff(user)) notFound();
  return { user, token };
}

export function safeRedirectPath(
  value: unknown,
  fallback = '/konto'
): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }

  return value;
}