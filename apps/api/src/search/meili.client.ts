/**
 * Schlanker Meilisearch-Client über fetch (keine zusätzliche Abhängigkeit).
 * Nur die Endpunkte, die MarktAT braucht: https://www.meilisearch.com/docs/reference/api/overview
 */

export class MeiliError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface MeiliTask {
  taskUid: number;
}

interface TaskStatus {
  uid: number;
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error?: { message: string; code: string } | null;
}

export interface MeiliSearchResponse<T> {
  hits: T[];
  totalHits?: number;
  estimatedTotalHits?: number;
  page?: number;
  hitsPerPage?: number;
  processingTimeMs: number;
}

export class MeiliClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs = 3000,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.url), {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new MeiliError(`Meilisearch nicht erreichbar: ${(error as Error).message}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      const info = (data ?? {}) as { message?: string; code?: string };
      throw new MeiliError(info.message ?? `Meilisearch antwortet mit ${response.status}`, response.status, info.code);
    }
    return data as T;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const health = await this.request<{ status: string }>('GET', '/health', undefined, 1500);
      return health.status === 'available';
    } catch {
      return false;
    }
  }

  /** Wartet, bis eine asynchrone Aufgabe (Indexieren, Einstellungen …) erledigt ist. */
  async waitForTask(task: MeiliTask, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let delay = 25;
    while (Date.now() < deadline) {
      const status = await this.request<TaskStatus>('GET', `/tasks/${task.taskUid}`);
      if (status.status === 'succeeded') return;
      if (status.status === 'failed' || status.status === 'canceled') {
        throw new MeiliError(status.error?.message ?? `Aufgabe ${task.taskUid} fehlgeschlagen`, undefined, status.error?.code);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 500);
    }
    throw new MeiliError(`Zeitüberschreitung bei Aufgabe ${task.taskUid}`);
  }

  async indexExists(uid: string): Promise<boolean> {
    try {
      await this.request('GET', `/indexes/${uid}`);
      return true;
    } catch (error) {
      if (error instanceof MeiliError && error.code === 'index_not_found') return false;
      throw error;
    }
  }

  createIndex(uid: string, primaryKey: string) {
    return this.request<MeiliTask>('POST', '/indexes', { uid, primaryKey });
  }

  deleteIndex(uid: string) {
    return this.request<MeiliTask>('DELETE', `/indexes/${uid}`);
  }

  getSettings<T>(uid: string) {
    return this.request<T>('GET', `/indexes/${uid}/settings`);
  }

  updateSettings(uid: string, settings: unknown) {
    return this.request<MeiliTask>('PATCH', `/indexes/${uid}/settings`, settings);
  }

  addDocuments(uid: string, documents: unknown[]) {
    return this.request<MeiliTask>('POST', `/indexes/${uid}/documents`, documents);
  }

  deleteDocuments(uid: string, ids: string[]) {
    return this.request<MeiliTask>('POST', `/indexes/${uid}/documents/delete-batch`, ids);
  }

  deleteAllDocuments(uid: string) {
    return this.request<MeiliTask>('DELETE', `/indexes/${uid}/documents`);
  }

  deleteDocumentsByFilter(uid: string, filter: string) {
    return this.request<MeiliTask>('POST', `/indexes/${uid}/documents/delete`, { filter });
  }

  /** Dokument-IDs mit Änderungszeitpunkt seitenweise (für den Abgleich mit der Datenbank). */
  getDocumentIds(uid: string, offset: number, limit: number) {
    return this.request<{ results: { id: string; updatedAt?: number }[]; total: number }>('POST', `/indexes/${uid}/documents/fetch`, {
      fields: ['id', 'updatedAt'],
      offset,
      limit,
    });
  }

  swapIndexes(a: string, b: string) {
    return this.request<MeiliTask>('POST', '/swap-indexes', [{ indexes: [a, b] }]);
  }

  search<T>(uid: string, body: Record<string, unknown>) {
    return this.request<MeiliSearchResponse<T>>('POST', `/indexes/${uid}/search`, body);
  }
}
