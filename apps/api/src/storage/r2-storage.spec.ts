import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'node:stream';
import { createR2Client, R2Storage } from './r2-storage.js';
import { ObjectTooLargeError } from './storage.types.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const client = () =>
  createR2Client({
    endpoint: `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`,
    bucket: 'marktat-dev',
    accessKeyId: 'AKIDTEST',
    secretAccessKey: 'test-secret',
  });

describe('R2Storage (ohne Netzwerk)', () => {
  it('signiert Upload-URLs kurzlebig und mit Content-Type und Content-Length', async () => {
    const storage = new R2Storage(client(), 'marktat-dev');
    const upload = await storage.presignUpload('uploads/l1/i1', {
      contentType: 'image/jpeg',
      contentLength: 12345,
      expiresInSeconds: 300,
    });
    const url = new URL(upload.url);
    expect(url.origin).toBe(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe('/marktat-dev/uploads/l1/i1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^AKIDTEST\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    // Der geheime Schlüssel selbst steht nie in der URL
    expect(upload.url).not.toContain('test-secret');
    expect(upload.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('signiert Lese-URLs mit der angegebenen Gültigkeit', async () => {
    const url = new URL(
      await new R2Storage(client(), 'marktat-dev').presignDownload('images/l1/i1/thumb.webp', 3600),
    );
    expect(url.pathname).toBe('/marktat-dev/images/l1/i1/thumb.webp');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  describe('mit gemocktem S3-Client', () => {
    const s3 = mockClient(S3Client);
    beforeEach(() => s3.reset());

    it('liefert null für fehlende Objekte', async () => {
      s3.on(HeadObjectCommand).rejects(
        new NotFound({ message: 'Not Found', $metadata: { httpStatusCode: 404 } }),
      );
      expect(await new R2Storage(new S3Client({}), 'b').head('fehlt')).toBeNull();
    });

    it('bricht beim Lesen über der Größengrenze ab', async () => {
      s3.on(GetObjectCommand).resolves({
        ContentLength: 20,
        Body: sdkStreamMixin(Readable.from([Buffer.alloc(20)])),
      });
      await expect(new R2Storage(new S3Client({}), 'b').getBytes('k', 10)).rejects.toThrow(
        ObjectTooLargeError,
      );
      s3.on(GetObjectCommand).resolves({
        Body: sdkStreamMixin(Readable.from([Buffer.alloc(8), Buffer.alloc(8)])),
      });
      await expect(new R2Storage(new S3Client({}), 'b').getBytes('k', 10)).rejects.toThrow(
        ObjectTooLargeError,
      );
    });

    it('löscht jeden Schlüssel einzeln', async () => {
      s3.on(DeleteObjectCommand).resolves({});
      await new R2Storage(new S3Client({}), 'b').deleteMany(['a', 'b/c']);
      expect(s3.commandCalls(DeleteObjectCommand).map((c) => c.args[0].input)).toEqual([
        { Bucket: 'b', Key: 'a' },
        { Bucket: 'b', Key: 'b/c' },
      ]);
    });
  });
});
