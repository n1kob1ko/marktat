/**
 * Lädt eine (bereits verschlüsselte) Datenbanksicherung in den eigenen Backup-Bucket bei Cloudflare R2.
 * Wird von infra/production/backup.sh aufgerufen, nicht von Hand:
 *
 *   pnpm backup:upload /backups/marktat-20261027T033000Z.dump.gpg
 *
 * Braucht BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY (eigenes Token nur für diesen Bucket)
 * und denselben Account wie die Bilder (R2_ACCOUNT_ID/R2_JURISDICTION bzw. R2_ENDPOINT).
 * Aufbewahrung im Bucket über eine Lifecycle-Regel (docs/deployment.md).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { loadEnv } from '../src/config/env.js';
import { r2Endpoint } from '../src/storage/r2-config.js';
import { createR2Client } from '../src/storage/r2-storage.js';

const file = process.argv.slice(2).find((arg) => arg !== '--');
if (!file || !file.endsWith('.gpg')) {
  console.error('Aufruf: pnpm backup:upload <datei>.gpg (nur verschlüsselte Sicherungen)');
  process.exit(1);
}
const env = loadEnv();
const bucket = process.env.BACKUP_R2_BUCKET;
const accessKeyId = process.env.BACKUP_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.BACKUP_R2_SECRET_ACCESS_KEY;
if (!bucket || !accessKeyId || !secretAccessKey) {
  console.error('BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID und BACKUP_R2_SECRET_ACCESS_KEY setzen.');
  process.exit(1);
}
if (bucket === env.R2_BUCKET) {
  console.error('Der Backup-Bucket darf nicht der Bilder-Bucket sein.');
  process.exit(1);
}
const endpoint = env.R2_ENDPOINT ?? r2Endpoint(env.R2_ACCOUNT_ID ?? '', env.R2_JURISDICTION);
const client = createR2Client({ endpoint, bucket, accessKeyId, secretAccessKey });
const key = `db/${basename(file)}`;
const size = statSync(file).size;

await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(file), ContentType: 'application/pgp-encrypted' }));
const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
if (head.ContentLength !== size) throw new Error(`Upload unvollständig: ${head.ContentLength} von ${size} Bytes`);
console.log(`hochgeladen: ${bucket}/${key} (${(size / 1024).toFixed(0)} KB)`);
