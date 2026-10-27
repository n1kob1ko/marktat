import 'server-only';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import type { MeResponse } from '@marktat/shared';
import { api, ApiError } from './api';
import { createSupabaseServerClient } from './supabase/server';

export async function getAccessToken(): Promise<string | null> {
  await connection();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
}

export async function getCurrentUser(): Promise<MeResponse | null> {
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
}

export async function requireUser(
  returnTo: string
): Promise<{ user: MeResponse; token: string }> {
  const token = await getAccessToken();
  const user = token ? await getCurrentUser() : null;

  if (!token || !user) {
    redirect(`/anmelden?weiter=${encodeURIComponent(returnTo)}`);
  }

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