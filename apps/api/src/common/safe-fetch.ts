import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { isSafeExternalUrl } from '@marktat/shared';

/**
 * Abrufe fremder Adressen (Linkprüfung von Deals, freigegebene Händler-Feeds) ohne SSRF-Risiko:
 * nur https, nur öffentliche IP-Adressen – geprüft beim Verbindungsaufbau selbst (kein DNS-Rebinding),
 * Weiterleitungen werden einzeln erneut geprüft, Größe und Dauer sind begrenzt.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Öffentlich erreichbare Adresse? (IPv4-gemappte IPv6-Adressen werden als IPv4 geprüft) */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1]!, 'ipv4');
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return !blocked.check(address, 'ipv6');
  return false;
}

export class SafeFetchError extends Error {
  constructor(
    message: string,
    /** Netzwerkfehler (DNS, Zeitüberschreitung, Verbindung, Weiterleitungsschleife) – sagt nichts darüber, ob die Seite existiert */
    readonly transient: boolean,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  /** Nur POST: Anfragetext (z. B. JSON) */
  body?: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Nur Tests: lokale Testserver (http, 127.0.0.1) erlauben */
  allowPrivate?: boolean;
  /** Längere Adressen erlauben (Feed-Downloads mit Spaltenliste); Standard 500 Zeichen */
  maxUrlLength?: number;
}

export interface SafeFetchResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
  /** Abgeschnitten, weil größer als maxBytes */
  truncated: boolean;
}

const USER_AGENT = 'MarktAT-Pruefdienst/1.0 (+Deals: Link- und Feedpruefung)';

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: object, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      const list = addresses as LookupAddress[];
      const unsafe = list.find((entry) => !isPublicAddress(entry.address));
      if (!allowPrivate && (unsafe || !list.length)) {
        const blockedError = Object.assign(new Error(`Adresse ${hostname} ist nicht öffentlich erreichbar`), { code: 'EBLOCKED' });
        return callback(blockedError, '', 4);
      }
      if ((options as { all?: boolean }).all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

type RequestSettings = Required<Pick<SafeFetchOptions, 'method' | 'maxBytes' | 'timeoutMs' | 'allowPrivate'>> & { headers: Record<string, string>; body?: string };

/** Antwort als Datenstrom (große Feeds): Aufrufer liest und begrenzt selbst; Zeitlimit gilt bis zum Ende */
export interface SafeStreamResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
  finalUrl: string;
}

function openRequest(url: URL, options: RequestSettings, onResponse: (response: http.IncomingMessage) => void, onError: (error: SafeFetchError) => void) {
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request(
    url,
    {
      method: options.method,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...(options.body !== undefined && { 'Content-Length': String(Buffer.byteLength(options.body)) }),
        ...options.headers,
      },
      lookup: guardedLookup(options.allowPrivate) as never,
      timeout: options.timeoutMs,
      // Kein Proxy, keine Wiederverwendung von Verbindungen: jede Anfrage prüft ihre Zieladresse selbst
      agent: false,
    },
    onResponse,
  );
  const timer = setTimeout(() => request.destroy(new Error('Zeitüberschreitung')), options.timeoutMs);
  timer.unref();
  request.on('timeout', () => request.destroy(new Error('Zeitüberschreitung')));
  request.on('error', (error: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    onError(new SafeFetchError(error.code === 'EBLOCKED' ? error.message : `Nicht erreichbar: ${error.code ?? error.message}`, error.code !== 'EBLOCKED'));
  });
  request.on('close', () => clearTimeout(timer));
  request.end(options.body);
  return request;
}

/**
 * Wie safeFetch, liefert die Antwort aber als Datenstrom (für große Produktfeeds). Weiterleitungen werden wie bei
 * safeFetch einzeln geprüft. Der Aufrufer muss den Strom vollständig lesen oder mit destroy() abbrechen.
 */
export async function safeFetchStream(input: string, options: SafeFetchOptions = {}): Promise<SafeStreamResponse> {
  const settings: RequestSettings = {
    method: options.method ?? 'GET',
    maxBytes: options.maxBytes ?? 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 10_000,
    allowPrivate: options.allowPrivate ?? false,
    headers: options.headers ?? {},
    body: options.body,
  };
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; ; hop++) {
    const allowed = settings.allowPrivate ? /^https?:\/\//.test(current) : isSafeExternalUrl(current, options.maxUrlLength);
    if (!allowed) throw new SafeFetchError('Adresse ist nicht erlaubt (nur öffentliche https-Adressen)', false);
    const url = new URL(current);
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      openRequest(url, settings, resolve, reject);
    });
    const location = response.headers.location;
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      if (hop >= maxRedirects) throw new SafeFetchError('Zu viele Weiterleitungen', true);
      current = new URL(location, current).toString();
      continue;
    }
    return { status: response.statusCode ?? 0, headers: response.headers, stream: response, finalUrl: url.toString() };
  }
}

function requestOnce(url: URL, options: RequestSettings) {
  return new Promise<SafeFetchResponse>((resolve, reject) => {
    openRequest(
      url,
      options,
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const done = () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), finalUrl: url.toString(), truncated });
        response.on('end', done);
        response.on('close', () => (truncated ? done() : undefined));
        response.on('error', (error) => (truncated ? done() : reject(new SafeFetchError(error.message, true))));
      },
      reject,
    );
  });
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const settings: RequestSettings = {
    method: options.method ?? 'GET',
    maxBytes: options.maxBytes ?? 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 10_000,
    allowPrivate: options.allowPrivate ?? false,
    headers: options.headers ?? {},
    body: options.body,
  };
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; ; hop++) {
    const allowed = settings.allowPrivate ? /^https?:\/\//.test(current) : isSafeExternalUrl(current, options.maxUrlLength);
    if (!allowed) throw new SafeFetchError('Adresse ist nicht erlaubt (nur öffentliche https-Adressen)', false);
    const response = await requestOnce(new URL(current), settings);
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= maxRedirects) throw new SafeFetchError('Zu viele Weiterleitungen', true);
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
}
