import { Logger } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { MeiliClient } from './meili.client.js';

const BATCH = 500;

/** Was ein weiterer Suchindex (Deals, Dienstleister) über seine Daten wissen muss */
export interface SecondaryIndexSource<Row extends { id: string }> {
  /** z. B. "listings_deals" */
  uid: string;
  settings: Record<string, unknown>;
  /** Aufbau der Dokumente; ältere Dokumente werden beim Abgleich neu geschrieben */
  version: number;
  /** Zeilen zu den IDs laden (unabhängig von der Sichtbarkeit) */
  load(ids: string[]): Promise<Row[]>;
  isVisible(row: Row, now: Date): boolean;
  /** Muss `id`, `updatedAt` (Sekunden) und `v` enthalten */
  toDocument(row: Row): Record<string, unknown>;
  /** Alle sichtbaren IDs mit Änderungszeitpunkt (für Abgleich und Neuaufbau), seitenweise ab `cursor` */
  visiblePage(cursor: string | undefined, take: number): Promise<{ id: string; updatedAt: Date }[]>;
  /** Filter für Dokumente, die inzwischen abgelaufen sind (regelmäßig entfernt) */
  expiredFilter?(nowSeconds: number): string;
}

/**
 * Kleiner Bruder von SearchIndexService für weitere Bereiche: hält einen Meilisearch-Index im Hintergrund aktuell,
 * holt verschobene Aktualisierungen nach und gleicht nach Ausfällen ab. Die Suche selbst lädt Treffer immer frisch
 * aus PostgreSQL und prüft dort nochmals die Sichtbarkeit.
 */
export class SecondaryIndex<Row extends { id: string }> {
  private readonly logger: Logger;
  private ready: Promise<boolean> | null = null;
  private readonly pending = new Set<string>();
  private needsFullSync = false;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    readonly client: MeiliClient | null,
    private readonly source: SecondaryIndexSource<Row>,
    name: string,
  ) {
    this.logger = new Logger(name);
  }

  get enabled() {
    return this.client !== null;
  }

  get uid() {
    return this.source.uid;
  }

  ensureReady(): Promise<boolean> {
    if (!this.client) return Promise.resolve(false);
    this.ready ??= this.prepare(this.source.uid).then(
      () => true,
      (error: Error) => {
        this.logger.warn(`Suchindex ${this.source.uid} nicht bereit: ${error.message}`);
        this.ready = null;
        this.needsFullSync = true;
        return false;
      },
    );
    return this.ready;
  }

  sync(id: string) {
    if (!this.client) return;
    this.track(this.syncNow([id], loadEnv().NODE_ENV === 'test'));
  }

  syncMany(ids: string[]) {
    if (!this.client || !ids.length) return;
    this.track(this.syncNow(ids, loadEnv().NODE_ENV === 'test'));
  }

  async flush() {
    while (this.inFlight.size) await Promise.allSettled(this.inFlight);
  }

  async syncNow(ids: string[], wait = false): Promise<boolean> {
    if (!this.client || !ids.length) return false;
    try {
      if (!(await this.ensureReady())) throw new Error('Index nicht bereit');
      const tasks = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const now = new Date();
        const rows = await this.source.load(chunk);
        const visible = rows.filter((row) => this.source.isVisible(row, now));
        const visibleIds = new Set(visible.map((row) => row.id));
        const hidden = chunk.filter((id) => !visibleIds.has(id));
        if (visible.length) tasks.push(await this.client.addDocuments(this.source.uid, visible.map((row) => this.source.toDocument(row))));
        if (hidden.length) tasks.push(await this.client.deleteDocuments(this.source.uid, hidden));
      }
      if (wait) for (const task of tasks) await this.client.waitForTask(task);
      for (const id of ids) this.pending.delete(id);
      return true;
    } catch (error) {
      for (const id of ids) this.pending.add(id);
      this.logger.warn(`Aktualisierung von ${this.source.uid} verschoben (${ids.length}): ${(error as Error).message}`);
      return false;
    }
  }

  /** Neuaufbau ohne Ausfall: neuer Index, danach Tausch */
  async reindexAll(): Promise<{ indexed: number }> {
    const client = this.requireClient();
    const tmp = `${this.source.uid}_reindex`;
    if (await client.indexExists(tmp)) await client.waitForTask(await client.deleteIndex(tmp));
    await this.prepare(tmp);
    let indexed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.source.visiblePage(cursor, BATCH);
      if (!page.length) break;
      const now = new Date();
      const rows = (await this.source.load(page.map((p) => p.id))).filter((row) => this.source.isVisible(row, now));
      if (rows.length) await client.waitForTask(await client.addDocuments(tmp, rows.map((row) => this.source.toDocument(row))), 120_000);
      indexed += rows.length;
      cursor = page.at(-1)!.id;
    }
    if (!(await client.indexExists(this.source.uid))) await this.prepare(this.source.uid);
    await client.waitForTask(await client.swapIndexes(this.source.uid, tmp));
    await client.waitForTask(await client.deleteIndex(tmp));
    this.pending.clear();
    this.needsFullSync = false;
    this.ready = Promise.resolve(true);
    return { indexed };
  }

  /** Abgleich: fehlende bzw. geänderte ergänzen, nicht mehr sichtbare entfernen */
  async reconcile(): Promise<{ added: number; removed: number } | null> {
    const client = this.client;
    if (!client || !(await this.ensureReady())) return null;
    try {
      const indexed = new Map<string, number | undefined>();
      for (let offset = 0; ; offset += 1000) {
        const page = await client.getDocumentIds(this.source.uid, offset, 1000);
        for (const doc of page.results) indexed.set(doc.id, doc.v === this.source.version ? doc.updatedAt : undefined);
        if (offset + 1000 >= page.total) break;
      }
      const visible: { id: string; updatedAt: Date }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await this.source.visiblePage(cursor, 5000);
        if (!page.length) break;
        visible.push(...page);
        cursor = page.at(-1)!.id;
      }
      const visibleIds = new Set(visible.map((r) => r.id));
      const missing = visible.filter((r) => indexed.get(r.id) !== Math.floor(r.updatedAt.getTime() / 1000)).map((r) => r.id);
      const stale = [...indexed.keys()].filter((id) => !visibleIds.has(id));
      if (missing.length) await this.syncNow(missing, true);
      if (stale.length) await client.waitForTask(await client.deleteDocuments(this.source.uid, stale));
      this.needsFullSync = false;
      return { added: missing.length, removed: stale.length };
    } catch (error) {
      this.needsFullSync = true;
      this.logger.warn(`Abgleich von ${this.source.uid} fehlgeschlagen: ${(error as Error).message}`);
      return null;
    }
  }

  async maintenance() {
    const client = this.client;
    if (!client || !(await this.ensureReady())) return;
    if (this.needsFullSync) {
      await this.reconcile();
      return;
    }
    if (this.pending.size) await this.syncNow([...this.pending]);
    const filter = this.source.expiredFilter?.(Math.floor(Date.now() / 1000));
    if (filter) await client.deleteDocumentsByFilter(this.source.uid, filter).catch((error: Error) => this.logger.warn(error.message));
  }

  /** Nur Tests */
  async clear() {
    if (!this.client || !(await this.ensureReady())) return;
    await this.flush();
    await this.client.waitForTask(await this.client.deleteAllDocuments(this.source.uid));
    this.pending.clear();
  }

  private async prepare(uid: string) {
    const client = this.requireClient();
    if (!(await client.indexExists(uid))) {
      try {
        await client.waitForTask(await client.createIndex(uid, 'id'));
      } catch (error) {
        if (!(await client.indexExists(uid))) throw error;
      }
    }
    const current = await client.getSettings<Record<string, unknown>>(uid);
    if (!matches(this.source.settings, current)) await client.waitForTask(await client.updateSettings(uid, this.source.settings), 120_000);
  }

  private requireClient(): MeiliClient {
    if (!this.client) throw new Error('Meilisearch ist nicht konfiguriert (MEILI_URL).');
    return this.client;
  }

  track(promise: Promise<unknown>) {
    const tracked = promise.catch((error: Error) => this.logger.error(`${this.source.uid}: ${error.message}`)).finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }
}

function matches(desired: unknown, current: unknown): boolean {
  if (Array.isArray(desired)) {
    return Array.isArray(current) && desired.length === current.length && desired.every((value, i) => matches(value, current[i]));
  }
  if (desired && typeof desired === 'object') {
    if (!current || typeof current !== 'object') return false;
    return Object.entries(desired).every(([key, value]) => matches(value, (current as Record<string, unknown>)[key]));
  }
  return desired === current;
}

/** Client für weitere Indizes (gleiche Verbindung wie der Inserate-Index) */
export function createMeiliClient(): MeiliClient | null {
  const env = loadEnv();
  return env.MEILI_URL ? new MeiliClient(env.MEILI_URL, env.MEILI_MASTER_KEY) : null;
}
