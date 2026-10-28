import { Injectable, Logger } from '@nestjs/common';
import { PassThrough, Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { redact } from '../common/redact.js';
import { safeFetch, safeFetchStream, SafeFetchError } from '../common/safe-fetch.js';
import { loadEnv } from '../config/env.js';
import { readCsvRecords } from './csv-stream.js';
import { parseFeedDate } from './awin-mapping.js';

/**
 * Zugriff auf Awin als Publisher (kein Advertiser-Tarif):
 * - Feedliste und Produktfeeds über productdata.awin.com mit dem Feed-Schlüssel („Create-a-Feed“)
 * - Aktionen und Gutscheine über die Publisher-API (api.awin.com, Token aus ui.awin.com/awin-api)
 * Grenzen laut Awin: API höchstens 20 Aufrufe je Minute; Feeds nur bei geändertem Stand („Last Imported“) laden.
 * Schlüssel stehen nur in der Umgebung und erscheinen nie in Fehlermeldungen (redact) oder in der Datenbank.
 */

export class AwinError extends Error {
  constructor(
    message: string,
    /** Lohnt ein erneuter Versuch (429, 5xx, Netzwerk)? */
    readonly transient: boolean,
  ) {
    super(redact(message));
  }
}

export interface AwinFeedListEntry {
  advertiserId: string;
  advertiserName: string;
  region: string | null;
  membership: 'JOINED' | 'NOT_JOINED' | 'PENDING' | 'SUSPENDED' | 'UNKNOWN';
  feedId: string;
  feedName: string;
  language: string | null;
  vertical: string | null;
  lastImported: Date | null;
  /** Download-Adresse inkl. Schlüssel – nur im Speicher, nie speichern oder protokollieren */
  url: string;
}

export interface AwinPromotion {
  promotionId: string;
  type: 'PROMOTION' | 'VOUCHER';
  advertiserId: string;
  advertiserName: string;
  joined: boolean;
  title: string;
  description: string;
  terms: string | null;
  startDate: Date | null;
  endDate: Date | null;
  urlTracking: string | null;
  voucherCode: string | null;
}

const USER_AGENT = 'MarktAT-Affiliate/1.0 (+Awin-Publisher; Feeds nur bei geändertem Stand)';
/** Etwas unter dem Limit von 20 Aufrufen je Minute bleiben */
const API_CALLS_PER_MINUTE = 18;
const FEED_TIMEOUT_MS = 15 * 60_000;
/** Entpackt höchstens so viel (Schutz vor beschädigten oder endlosen Downloads) */
const FEED_MAX_BYTES = 2 * 1024 ** 3;

export function membershipOf(value: string): AwinFeedListEntry['membership'] {
  const v = value.trim().toLowerCase();
  if (!v) return 'UNKNOWN';
  if (v.includes('not') || v.includes('nicht')) return 'NOT_JOINED';
  if (v.includes('pending') || v.includes('offen')) return 'PENDING';
  if (v.includes('suspend') || v.includes('reject') || v.includes('declin') || v.includes('abgelehnt')) return 'SUSPENDED';
  if (v === 'joined' || v === 'active' || v.includes('joined') || v === 'aktiv') return 'JOINED';
  return 'UNKNOWN';
}

@Injectable()
export class AwinClient {
  private readonly logger = new Logger(AwinClient.name);
  private readonly apiCalls: number[] = [];

  /** Fehlende Einstellungen (nur Namen) */
  missingConfig(): string[] {
    const env = loadEnv();
    return (['AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN', 'AWIN_FEED_API_KEY'] as const).filter((name) => !env[name]);
  }

  get enabled() {
    return loadEnv().AWIN_ENABLED;
  }

  /** Feedliste: alle Feeds der Programme, denen wir beigetreten sind (bzw. die Werbung vor dem Beitritt erlauben) */
  async feedList(): Promise<AwinFeedListEntry[]> {
    const env = loadEnv();
    if (!env.AWIN_FEED_API_KEY) throw new AwinError('AWIN_FEED_API_KEY fehlt.', false);
    const url = `${env.AWIN_PRODUCTDATA_URL}/datafeed/list/apikey/${encodeURIComponent(env.AWIN_FEED_API_KEY)}`;
    const response = await this.withRetry('Feedliste', async () => {
      const r = await safeFetch(url, { maxBytes: 20 * 1024 * 1024, timeoutMs: 60_000, headers: { 'user-agent': USER_AGENT, accept: 'text/csv' }, allowPrivate: env.OUTBOUND_ALLOW_PRIVATE, maxUrlLength: 2000 });
      if (r.status === 429 || r.status >= 500) throw new AwinError(`Awin antwortet bei der Feedliste mit HTTP ${r.status}.`, true);
      return r;
    });
    if (response.status !== 200) {
      throw new AwinError(`Awin antwortet bei der Feedliste mit HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (Feed-Schlüssel prüfen)' : ''}.`, false);
    }
    if (response.truncated) throw new AwinError('Die Feedliste ist ungewöhnlich groß.', false);
    const entries: AwinFeedListEntry[] = [];
    for await (const row of readCsvRecords(Readable.from([response.body]))) {
      const feedId = (row['feed id'] ?? row['feed_id'] ?? '').trim();
      const advertiserId = (row['advertiser id'] ?? row['advertiser_id'] ?? '').trim();
      const download = (row['url'] ?? '').trim();
      if (!/^\d{1,20}$/.test(feedId) || !/^\d{1,20}$/.test(advertiserId) || !download) continue;
      entries.push({
        advertiserId,
        advertiserName: (row['advertiser name'] ?? row['advertiser_name'] ?? '').trim().slice(0, 120) || `Programm ${advertiserId}`,
        region: (row['primary region'] ?? row['primary_region'] ?? '').trim().slice(0, 10) || null,
        membership: membershipOf(row['membership status'] ?? row['membership_status'] ?? ''),
        feedId,
        feedName: (row['feed name'] ?? row['feed_name'] ?? '').trim().slice(0, 200) || `Feed ${feedId}`,
        language: (row['language'] ?? '').trim().slice(0, 10) || null,
        vertical: (row['vertical'] ?? '').trim().slice(0, 60) || null,
        lastImported: parseFeedDate(row['last imported'] ?? row['last_imported'] ?? '', 'start'),
        url: download,
      });
    }
    return entries;
  }

  /** Produktfeed als Strom von Zeilen (gzip wird erkannt und entpackt). Abbrechen mit `close()`. */
  async openFeed(downloadUrl: string): Promise<{ rows: AsyncGenerator<Record<string, string>>; close: () => void }> {
    const env = loadEnv();
    // Nur Adressen des konfigurierten Feed-Servers (Schutz, falls die Feedliste unerwartete Adressen enthielte)
    if (new URL(downloadUrl).origin !== new URL(env.AWIN_PRODUCTDATA_URL).origin) throw new AwinError('Die Download-Adresse des Feeds gehört nicht zu Awin.', false);
    const response = await this.withRetry('Feed', () =>
      safeFetchStream(downloadUrl, { timeoutMs: FEED_TIMEOUT_MS, headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity' }, allowPrivate: env.OUTBOUND_ALLOW_PRIVATE, maxUrlLength: 8000 }).then((r) => {
        if (r.status === 429 || r.status >= 500) {
          r.stream.resume();
          throw new AwinError(`Awin antwortet beim Feed mit HTTP ${r.status}.`, true);
        }
        return r;
      }),
    );
    if (response.status !== 200) {
      response.stream.resume();
      throw new AwinError(`Awin antwortet beim Feed mit HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (Feed-Schlüssel oder Partnerschaft prüfen)' : ''}.`, false);
    }
    const decoded = await decode(response.stream);
    return { rows: readCsvRecords(decoded), close: () => response.stream.destroy() };
  }

  /** Aktive Aktionen und Gutscheine der beigetretenen Programme für eine Region (seitenweise) */
  async promotions(page: number, pageSize = 200): Promise<{ items: AwinPromotion[]; total: number }> {
    const env = loadEnv();
    if (!env.AWIN_PUBLISHER_ID || !env.AWIN_API_TOKEN) throw new AwinError('AWIN_PUBLISHER_ID oder AWIN_API_TOKEN fehlt.', false);
    const body = JSON.stringify({
      filters: { membership: 'joined', regionCodes: [env.AWIN_REGION], status: 'active', type: 'all' },
      pagination: { page, pageSize },
    });
    const response = await this.withRetry('Aktionen', async () => {
      await this.throttleApi();
      const r = await safeFetch(`${env.AWIN_API_URL}/publisher/${env.AWIN_PUBLISHER_ID}/promotions`, {
        method: 'POST',
        body,
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 60_000,
        headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${env.AWIN_API_TOKEN}` },
        allowPrivate: env.OUTBOUND_ALLOW_PRIVATE,
      });
      if (r.status === 429 || r.status >= 500) throw new AwinError(`Awin-API antwortet mit HTTP ${r.status}.`, true);
      return r;
    });
    if (response.status === 401 || response.status === 403) throw new AwinError('Awin-API: Zugriff verweigert (Token oder Publisher-ID prüfen).', false);
    if (response.status !== 200) throw new AwinError(`Awin-API antwortet mit HTTP ${response.status}.`, false);
    let json: unknown;
    try {
      json = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new AwinError('Awin-API: Antwort ist kein JSON.', false);
    }
    const data = (json as { data?: unknown[] }).data ?? [];
    const total = Number((json as { pagination?: { total?: number } }).pagination?.total ?? data.length);
    return { items: data.map(toPromotion).filter((p): p is AwinPromotion => p !== null), total: Number.isFinite(total) ? total : data.length };
  }

  /** Wartet, falls in der letzten Minute schon zu viele API-Aufrufe liefen */
  private async throttleApi() {
    for (;;) {
      const now = Date.now();
      while (this.apiCalls.length && this.apiCalls[0]! <= now - 60_000) this.apiCalls.shift();
      if (this.apiCalls.length < API_CALLS_PER_MINUTE) {
        this.apiCalls.push(now);
        return;
      }
      await sleep(this.apiCalls[0]! + 60_000 - now + 50);
    }
  }

  /** Bis zu drei Versuche mit wachsender Wartezeit bei 429, 5xx und Netzwerkfehlern */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const delays = loadEnv().NODE_ENV === 'test' ? [50, 100] : [15_000, 60_000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const transient = error instanceof AwinError ? error.transient : error instanceof SafeFetchError ? error.transient : false;
        const message = error instanceof Error ? error.message : String(error);
        if (!transient || attempt >= delays.length) {
          throw error instanceof AwinError ? error : new AwinError(`${label}: ${message}`, transient);
        }
        this.logger.warn(`${label}: ${redact(message)} – neuer Versuch in ${delays[attempt]! / 1000} s`);
        await sleep(delays[attempt]!);
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** gzip erkennen und entpacken; ZIP wird nicht unterstützt (in Create-a-Feed „gzip“ oder keine Komprimierung wählen) */
async function decode(stream: Readable): Promise<Readable> {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  const head: Buffer = first.done ? Buffer.alloc(0) : (first.value as Buffer);
  if (head[0] === 0x50 && head[1] === 0x4b) {
    stream.destroy();
    throw new AwinError('Der Feed ist als ZIP komprimiert. Bitte in Create-a-Feed „gzip“ wählen.', false);
  }
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > FEED_MAX_BYTES) return callback(new AwinError('Der Feed ist größer als 2 GB.', false));
      callback(null, chunk);
    },
  });
  const rest = Readable.from(
    (async function* () {
      if (!first.done) yield head;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value as Buffer;
      }
    })(),
  );
  const out = new PassThrough();
  const fail = (error: Error) => out.destroy(error);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const gunzip = createGunzip();
    rest.on('error', fail).pipe(gunzip).on('error', fail).pipe(limit).on('error', fail).pipe(out);
  } else {
    rest.on('error', fail).pipe(limit).on('error', fail).pipe(out);
  }
  return out;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toPromotion(raw: unknown): AwinPromotion | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const advertiser = (item.advertiser ?? {}) as Record<string, unknown>;
  const voucher = (item.voucher ?? null) as Record<string, unknown> | null;
  const promotionId = str(item.promotionId, 40);
  const advertiserId = str(advertiser.id, 40);
  const title = str(item.title, 200);
  if (!promotionId || !/^\d+$/.test(advertiserId) || !title) return null;
  const type = str(item.type, 20).toLowerCase() === 'voucher' ? 'VOUCHER' : 'PROMOTION';
  return {
    promotionId,
    type,
    advertiserId,
    advertiserName: str(advertiser.name, 120) || `Programm ${advertiserId}`,
    joined: advertiser.joined === true,
    title,
    description: str(item.description, 2000),
    terms: str(item.terms, 2000) || null,
    startDate: date(item.startDate),
    endDate: date(item.endDate),
    urlTracking: str(item.urlTracking, 1000) || null,
    voucherCode: voucher ? str(voucher.code, 80) || null : null,
  };
}
