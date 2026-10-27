import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { CategoriesService } from '../categories/categories.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeiliClient } from './meili.client.js';
import { indexSettings, isPubliclyVisible, searchDocumentInclude, toSearchDocument, type IndexableListing } from './search-document.js';

const BATCH = 500;
/** Wie oft fehlgeschlagene Aktualisierungen nachgeholt und abgelaufene Inserate entfernt werden */
const MAINTENANCE_INTERVAL_MS = 60_000;

export interface ReindexResult {
  indexed: number;
  durationMs: number;
}

/**
 * Hält den Meilisearch-Index aktuell.
 *
 * - Nach jeder Änderung an einem Inserat (anlegen, bearbeiten, veröffentlichen, pausieren, löschen …)
 *   wird `sync(id)` aufgerufen. Das läuft im Hintergrund: Ist Meilisearch gerade nicht erreichbar,
 *   gelingt die Aktion des Nutzers trotzdem, und die Aktualisierung wird nachgeholt.
 * - Abgelaufene Inserate werden regelmäßig entfernt; die Suche filtert sie ohnehin per `expiresAt`.
 * - War Meilisearch nicht erreichbar, wird nach der Rückkehr der Index vollständig abgeglichen.
 */
@Injectable()
export class SearchIndexService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexService.name);
  readonly client: MeiliClient | null;
  readonly indexUid: string;
  private ready: Promise<boolean> | null = null;
  private readonly pending = new Set<string>();
  private needsFullSync = false;
  private timer?: NodeJS.Timeout;
  private inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {
    const env = loadEnv();
    this.client = env.MEILI_URL ? new MeiliClient(env.MEILI_URL, env.MEILI_MASTER_KEY) : null;
    this.indexUid = env.MEILI_INDEX;
  }

  get enabled() {
    return this.client !== null;
  }

  onApplicationBootstrap() {
    if (!this.client) {
      this.logger.warn('MEILI_URL ist nicht gesetzt – die Suche läuft über PostgreSQL.');
      return;
    }
    // Nicht blockierend: die API startet auch, wenn Meilisearch (noch) nicht läuft.
    void this.ensureReady().then((ok) => {
      if (ok && loadEnv().NODE_ENV !== 'test') this.track(this.reconcile());
    });
    if (loadEnv().NODE_ENV !== 'test') {
      this.timer = setInterval(() => this.track(this.maintenance()), MAINTENANCE_INTERVAL_MS);
      this.timer.unref();
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await Promise.allSettled(this.inFlight);
  }

  /** Index anlegen und Einstellungen setzen (einmal pro Prozess bzw. erneut nach einem Ausfall). */
  ensureReady(): Promise<boolean> {
    if (!this.client) return Promise.resolve(false);
    this.ready ??= this.prepareIndex(this.indexUid).then(
      () => true,
      (error: Error) => {
        this.logger.warn(`Suchindex nicht bereit: ${error.message}`);
        this.ready = null;
        this.needsFullSync = true;
        return false;
      },
    );
    return this.ready;
  }

  /** Inserat im Hintergrund aktualisieren; Fehler werden protokolliert und später nachgeholt. */
  sync(listingId: string) {
    if (!this.client) return;
    // In Tests bis zur fertigen Indizierung warten, damit `flush()` einen konsistenten Stand liefert
    this.track(this.syncNow([listingId], loadEnv().NODE_ENV === 'test'));
  }

  /** Alle Inserate eines Verkäufers (z. B. nach Wechsel privat/gewerblich oder Sperre). */
  syncSeller(sellerId: string) {
    if (!this.client) return;
    this.track(
      this.prisma.listing
        .findMany({ where: { sellerId }, select: { id: true } })
        .then((rows) => this.syncNow(rows.map((r) => r.id))),
    );
  }

  /** Wartet auf alle laufenden Hintergrundaktualisierungen (für Tests und das Reindex-Skript). */
  async flush() {
    while (this.inFlight.size) await Promise.allSettled(this.inFlight);
  }

  /** Aktualisiert bzw. entfernt die Dokumente sofort. Gibt false zurück, wenn Meilisearch nicht erreichbar war. */
  async syncNow(ids: string[], wait = false): Promise<boolean> {
    if (!this.client || !ids.length) return false;
    try {
      if (!(await this.ensureReady())) throw new Error('Index nicht bereit');
      const rows = await this.prisma.listing.findMany({ where: { id: { in: ids } }, include: searchDocumentInclude });
      const now = new Date();
      const visible = rows.filter((row) => isPubliclyVisible(row, now));
      const visibleIds = new Set(visible.map((row) => row.id));
      const hidden = ids.filter((id) => !visibleIds.has(id));
      const tasks = [];
      if (visible.length) tasks.push(await this.client.addDocuments(this.indexUid, await this.documents(visible)));
      if (hidden.length) tasks.push(await this.client.deleteDocuments(this.indexUid, hidden));
      if (wait) for (const task of tasks) await this.client.waitForTask(task);
      for (const id of ids) this.pending.delete(id);
      return true;
    } catch (error) {
      for (const id of ids) this.pending.add(id);
      this.logger.warn(`Suchindex-Aktualisierung verschoben (${ids.length} Inserat(e)): ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Vollständige Neuindizierung ohne Ausfall: Alle sichtbaren Inserate werden in einen neuen Index
   * geschrieben, der danach mit dem bestehenden getauscht wird. Veraltete Einträge verschwinden dabei.
   */
  async reindexAll(): Promise<ReindexResult> {
    const client = this.requireClient();
    const started = Date.now();
    const tmp = `${this.indexUid}_reindex`;
    if (await client.indexExists(tmp)) await client.waitForTask(await client.deleteIndex(tmp));
    await this.prepareIndex(tmp);
    let indexed = 0;
    let cursor: string | undefined;
    for (;;) {
      const now = new Date();
      const rows = await this.prisma.listing.findMany({
        where: { status: 'ACTIVE', deletedAt: null, expiresAt: { gt: now }, seller: { status: 'ACTIVE', deletedAt: null } },
        include: searchDocumentInclude,
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
      });
      if (!rows.length) break;
      await client.waitForTask(await client.addDocuments(tmp, await this.documents(rows)), 120_000);
      indexed += rows.length;
      cursor = rows.at(-1)!.id;
    }
    if (!(await client.indexExists(this.indexUid))) await this.prepareIndex(this.indexUid);
    await client.waitForTask(await client.swapIndexes(this.indexUid, tmp));
    await client.waitForTask(await client.deleteIndex(tmp));
    this.pending.clear();
    this.needsFullSync = false;
    this.ready = Promise.resolve(true);
    return { indexed, durationMs: Date.now() - started };
  }

  /**
   * Abgleich ohne Neuaufbau (beim Start): fehlende Inserate ergänzen, nicht mehr sichtbare entfernen.
   */
  async reconcile(): Promise<{ added: number; removed: number } | null> {
    const client = this.client;
    if (!client || !(await this.ensureReady())) return null;
    try {
      const indexed = new Map<string, number | undefined>();
      for (let offset = 0; ; offset += 1000) {
        const page = await client.getDocumentIds(this.indexUid, offset, 1000);
        for (const doc of page.results) indexed.set(doc.id, doc.updatedAt);
        if (offset + 1000 >= page.total) break;
      }
      const now = new Date();
      const visible = await this.prisma.listing.findMany({
        where: { status: 'ACTIVE', deletedAt: null, expiresAt: { gt: now }, seller: { status: 'ACTIVE', deletedAt: null } },
        select: { id: true, updatedAt: true },
      });
      const visibleIds = new Set(visible.map((r) => r.id));
      // Fehlend oder seit der Indizierung geändert (z. B. während Meilisearch nicht erreichbar war)
      const missing = visible.filter((r) => indexed.get(r.id) !== Math.floor(r.updatedAt.getTime() / 1000)).map((r) => r.id);
      const stale = [...indexed.keys()].filter((id) => !visibleIds.has(id));
      for (let i = 0; i < missing.length; i += BATCH) await this.syncNow(missing.slice(i, i + BATCH), true);
      if (stale.length) await client.waitForTask(await client.deleteDocuments(this.indexUid, stale));
      this.needsFullSync = false;
      if (missing.length || stale.length) this.logger.log(`Suchindex abgeglichen: ${missing.length} aktualisiert, ${stale.length} entfernt`);
      return { added: missing.length, removed: stale.length };
    } catch (error) {
      this.needsFullSync = true;
      this.logger.warn(`Abgleich des Suchindex fehlgeschlagen: ${(error as Error).message}`);
      return null;
    }
  }

  /** Regelmäßig: verschobene Aktualisierungen nachholen, abgelaufene Inserate entfernen. */
  async maintenance() {
    const client = this.client;
    if (!client || !(await this.ensureReady())) return;
    if (this.needsFullSync) {
      await this.reconcile();
      return;
    }
    if (this.pending.size) await this.syncNow([...this.pending]);
    try {
      await client.deleteDocumentsByFilter(this.indexUid, `expiresAt <= ${Math.floor(Date.now() / 1000)}`);
    } catch (error) {
      this.logger.warn(`Abgelaufene Inserate nicht aus dem Index entfernt: ${(error as Error).message}`);
    }
  }

  /** Leert den Index (nur Tests: Daten werden zwischen Tests gelöscht). */
  async clear() {
    if (!this.client || !(await this.ensureReady())) return;
    await this.flush();
    await this.client.waitForTask(await this.client.deleteAllDocuments(this.indexUid));
    this.pending.clear();
  }

  /** Für Diagnose und Tests */
  pendingIds() {
    return [...this.pending];
  }

  private async prepareIndex(uid: string) {
    const client = this.requireClient();
    if (!(await client.indexExists(uid))) {
      try {
        await client.waitForTask(await client.createIndex(uid, 'id'));
      } catch (error) {
        // Parallel angelegt (z. B. zweite API-Instanz)
        if (!(await client.indexExists(uid))) throw error;
      }
    }
    const current = await client.getSettings<Record<string, unknown>>(uid);
    const desired = indexSettings();
    if (!matches(desired, current)) await client.waitForTask(await client.updateSettings(uid, desired), 120_000);
  }

  private async documents(rows: IndexableListing[]) {
    const tree = await this.categories.namesByPath();
    return rows.map((row) => toSearchDocument(row, (path) => tree.get(path) ?? []));
  }

  private requireClient(): MeiliClient {
    if (!this.client) throw new Error('Meilisearch ist nicht konfiguriert (MEILI_URL).');
    return this.client;
  }

  private track(promise: Promise<unknown>) {
    const tracked = promise.catch((error: Error) => this.logger.error(`Suchindex: ${error.message}`)).finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }
}

/** Sind alle gewünschten Einstellungen bereits gesetzt? (Meilisearch liefert zusätzliche Standardwerte mit.) */
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
