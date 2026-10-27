import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readToken, signToken } from '../common/signing.js';
import {
  ObjectTooLargeError,
  type ObjectStorage,
  type PresignedUpload,
  type PresignUploadOptions,
} from './storage.types.js';

export interface LocalStorageToken {
  op: 'put' | 'get';
  key: string;
  exp: number;
  contentType?: string;
  contentLength?: number;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * Speicher im lokalen Dateisystem mit HMAC-signierten URLs, die sich wie R2-Presigned-URLs verhalten.
 * Nur für automatisierte Tests und Offline-Entwicklung; in Produktion verbietet die Env-Prüfung diesen Treiber.
 */
export class LocalStorage implements ObjectStorage {
  constructor(
    private readonly root: string,
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key) || key.split('/').includes('..'))
      throw new Error(`Ungültiger Speicherschlüssel: ${key}`);
    return path.join(this.root, key);
  }

  private urlFor(payload: LocalStorageToken) {
    return `${this.baseUrl}/v1/local-storage/${signToken(this.secret, payload)}`;
  }

  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
    this.pathFor(key);
    const url = this.urlFor({
      op: 'put',
      key,
      exp: Date.now() + options.expiresInSeconds * 1000,
      contentType: options.contentType,
      contentLength: options.contentLength,
    });
    return { url, headers: { 'Content-Type': options.contentType } };
  }

  async presignDownload(key: string, expiresInSeconds: number) {
    this.pathFor(key);
    return this.urlFor({ op: 'get', key, exp: Date.now() + expiresInSeconds * 1000 });
  }

  /** Prüft ein Token aus einer signierten URL; null bei falscher Signatur, falscher Operation oder Ablauf. */
  verify(token: string, op: LocalStorageToken['op']): LocalStorageToken | null {
    const payload = readToken<LocalStorageToken>(this.secret, token);
    if (!payload || payload.op !== op || payload.exp < Date.now()) return null;
    return payload;
  }

  async head(key: string) {
    try {
      const file = await stat(this.pathFor(key));
      const contentType = await readFile(`${this.pathFor(key)}.type`, 'utf8').catch(
        () => undefined,
      );
      return { size: file.size, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getBytes(key: string, maxBytes: number) {
    const file = await stat(this.pathFor(key));
    if (file.size > maxBytes) throw new ObjectTooLargeError(maxBytes);
    return readFile(this.pathFor(key));
  }

  async put(key: string, body: Buffer, contentType: string) {
    const target = this.pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    await writeFile(`${target}.type`, contentType);
  }

  async deleteMany(keys: string[]) {
    await Promise.all(
      keys.flatMap((key) => [
        rm(this.pathFor(key), { force: true }),
        rm(`${this.pathFor(key)}.type`, { force: true }),
      ]),
    );
  }
}
