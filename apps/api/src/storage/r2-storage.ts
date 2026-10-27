import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { R2Config } from './r2-config.js';
import {
  ObjectTooLargeError,
  type ObjectStorage,
  type PresignedUpload,
  type PresignUploadOptions,
} from './storage.types.js';

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    // Pfad-Stil (https://<account>.r2.cloudflarestorage.com/<bucket>/<key>): ein fester Host für CORS und CSP
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Neuere SDK-Versionen hängen standardmäßig CRC-Prüfsummen an; Cloudflare empfiehlt für R2 „WHEN_REQUIRED“.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Cloudflare R2 über die S3-kompatible API. Der Bucket bleibt privat; Zugriff nur über signierte URLs. */
export class R2Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
    });
    // Content-Type und Content-Length werden mitsigniert: Eine andere Datei(größe) lehnt R2 ab.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': options.contentType } };
  }

  presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async head(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (
        error instanceof NotFound ||
        (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
      ) {
        return null;
      }
      throw error;
    }
  }

  async getBytes(key: string, maxBytes: number): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if ((result.ContentLength ?? 0) > maxBytes) {
      result.Body?.transformToWebStream()
        .cancel()
        .catch(() => undefined);
      throw new ObjectTooLargeError(maxBytes);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new ObjectTooLargeError(maxBytes);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async deleteMany(keys: string[]) {
    // Einzeln statt DeleteObjects: kommt ohne Pflicht-Prüfsumme aus und sind höchstens ein paar Schlüssel.
    await Promise.all(
      keys.map((Key) => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }))),
    );
  }
}
