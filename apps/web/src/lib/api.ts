import 'server-only';
import type { ApiError as ApiErrorBody } from '@marktat/shared';

import { serverEnv } from './env';

const API_URL = serverEnv.apiUrl;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  /** Feldfehler im Format { feld: [meldung] } für Formulare */
  fieldErrors(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const { path, message } of this.body.errors ?? []) {
      (result[path] ??= []).push(message);
    }
    return result;
  }
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  token?: string;
  body?: unknown;
  /** Höchstens so lange auf die API warten (Standard 15 s) – sonst hinge die Seite bei einer hängenden API endlos */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Serverseitiger Aufruf der MarktAT-API. Das Access-Token verlässt nie den Server. */
export async function api<T>(path: string, { token, body, headers, timeoutMs = DEFAULT_TIMEOUT_MS, ...init }: ApiOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1${path}`, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (timeout.aborted) {
      // Bei Änderungen (Nachricht, Inserat) kann die API sie trotzdem gespeichert haben – erneutes Abschicken ist sicher
      throw new ApiError(504, { statusCode: 504, message: 'Der Server antwortet gerade sehr langsam. Bitte versuche es gleich noch einmal.' });
    }
    throw new ApiError(503, { statusCode: 503, message: 'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.' });
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const errorBody =
      data && typeof data === 'object' && 'message' in data
        ? (data as ApiErrorBody)
        : { statusCode: response.status, message: 'Ein unerwarteter Fehler ist aufgetreten.' };
    throw new ApiError(response.status, errorBody);
  }
  return data as T;
}
