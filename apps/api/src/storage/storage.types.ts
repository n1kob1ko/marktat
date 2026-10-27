/** Schnittstelle zum Objektspeicher (Cloudflare R2 oder lokales Dateisystem für Tests). */
export interface ObjectStorage {
  /** Kurzlebige URL, mit der der Browser genau eine Datei mit genau diesem Typ und dieser Größe hochladen darf. */
  presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload>;
  /** Kurzlebige Lese-URL für ein privates Objekt. */
  presignDownload(key: string, expiresInSeconds: number): Promise<string>;
  /** Metadaten oder null, wenn das Objekt nicht existiert. */
  head(key: string): Promise<{ size: number; contentType?: string } | null>;
  /** Lädt ein Objekt in den Speicher; bricht ab, wenn es größer als maxBytes ist. */
  getBytes(key: string, maxBytes: number): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  /** Löscht Objekte; fehlende Schlüssel sind kein Fehler. */
  deleteMany(keys: string[]): Promise<void>;
}

export interface PresignUploadOptions {
  contentType: string;
  contentLength: number;
  expiresInSeconds: number;
}

export interface PresignedUpload {
  url: string;
  /** Header, die der Browser beim PUT mitschicken muss (Teil der Signatur) */
  headers: Record<string, string>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Objekt ist größer als ${maxBytes} Byte`);
  }
}

export class StorageNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`Objektspeicher nicht konfiguriert: ${missing.join(', ')} fehlt`);
  }
}
