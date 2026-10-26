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
}

/** Serverseitiger Aufruf der MarktAT-API. Das Access-Token verlässt nie den Server. */
export async function api<T>(path: string, { token, body, headers, ...init }: ApiOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
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
