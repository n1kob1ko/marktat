/**
 * Prüft die echte Cloudflare-R2-Verbindung mit den Werten aus der lokalen .env – ohne Geheimnisse auszugeben.
 *
 *   pnpm --filter @marktat/api r2:check            Verbindung, Upload, Sicherheit und CORS prüfen
 *   pnpm --filter @marktat/api r2:check --setup    zusätzlich CORS-Regel und Aufräumregel für uploads/ setzen
 *                                                   (braucht ein Token mit „Admin Read & Write“)
 *
 * Alle Testobjekte liegen unter „r2-check/…“ und werden am Ende gelöscht.
 */
import {
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { loadEnv } from '../src/config/env.js';
import { IMAGE_VARIANT_NAMES, processImage } from '../src/images/image-processor.js';
import { r2ConfigFromEnv, r2Endpoint, type R2Jurisdiction } from '../src/storage/r2-config.js';
import { createR2Client, R2Storage } from '../src/storage/r2-storage.js';

const ok = (text: string) => console.log(`  ✓ ${text}`);
const warn = (text: string) => console.log(`  ! ${text}`);
let failed = false;
const fail = (text: string) => {
  failed = true;
  console.log(`  ✗ ${text}`);
};
const mask = (value: string) => `${value.slice(0, 4)}…(${value.length} Zeichen)`;
const s3Error = (error: unknown) =>
  error instanceof S3ServiceException
    ? `${error.name} (HTTP ${error.$metadata.httpStatusCode})`
    : (error as Error).message;

async function main() {
  const env = loadEnv();
  const setup = process.argv.includes('--setup');
  console.log('\nMarktAT – R2-Verbindungstest\n');

  let config;
  try {
    config = r2ConfigFromEnv(env);
  } catch (error) {
    fail(
      `${(error as Error).message}. Werte in der lokalen .env eintragen (siehe .env.example und docs/bilder.md).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `  Endpoint:      ${new URL(config.endpoint).host.replace(env.R2_ACCOUNT_ID ?? '§', mask(env.R2_ACCOUNT_ID ?? ''))}`,
  );
  console.log(
    `  Jurisdiktion:  ${env.R2_ENDPOINT ? '(R2_ENDPOINT gesetzt)' : env.R2_JURISDICTION}`,
  );
  console.log(`  Bucket:        ${config.bucket}`);
  console.log(`  Access Key ID: ${mask(config.accessKeyId)}\n`);

  const client = createR2Client(config);
  const storage = new R2Storage(client, config.bucket);

  // 1. Bucket erreichbar? Bei „NoSuchBucket“ die anderen Jurisdiktionen probieren.
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    ok('Bucket erreichbar, Zugangsdaten gültig');
  } catch (error) {
    fail(`Bucket nicht erreichbar: ${s3Error(error)}`);
    if (env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) {
      for (const jurisdiction of ['default', 'eu', 'fedramp'] as R2Jurisdiction[]) {
        if (jurisdiction === env.R2_JURISDICTION) continue;
        const other = createR2Client({
          ...config,
          endpoint: r2Endpoint(env.R2_ACCOUNT_ID, jurisdiction),
        });
        const found = await other.send(new HeadBucketCommand({ Bucket: config.bucket })).then(
          () => true,
          () => false,
        );
        if (found)
          warn(
            `Der Bucket antwortet unter Jurisdiktion „${jurisdiction}“ → in .env R2_JURISDICTION=${jurisdiction} setzen.`,
          );
      }
    }
    warn('Prüfe R2_ACCOUNT_ID, R2_BUCKET und ob das API-Token Zugriff auf diesen Bucket hat.');
    process.exitCode = 1;
    return;
  }

  const prefix = `r2-check/${Date.now()}`;
  const created: string[] = [];
  try {
    // 2. Testbild mit GPS-Daten wie aus einer Handykamera
    const photo = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 15, g: 76, b: 58 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: 'R2-Check' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 12/1 30/1' },
      })
      .toBuffer();

    // 3. Presigned PUT wie im Browser
    const rawKey = `${prefix}/upload.jpg`;
    const upload = await storage.presignUpload(rawKey, {
      contentType: 'image/jpeg',
      contentLength: photo.length,
      expiresInSeconds: 300,
    });
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: photo });
    created.push(rawKey);
    if (put.ok) ok(`Upload über signierte URL (HTTP ${put.status}, ${photo.length} Byte)`);
    else fail(`Upload über signierte URL: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);

    // 4. Signatur schützt Größe und Typ
    const sizeKey = `${prefix}/falsche-groesse.jpg`;
    const sized = await storage.presignUpload(sizeKey, {
      contentType: 'image/jpeg',
      contentLength: 100,
      expiresInSeconds: 300,
    });
    const tooBig = await fetch(sized.url, { method: 'PUT', headers: sized.headers, body: photo });
    created.push(sizeKey);
    if (!tooBig.ok) ok(`Andere Dateigröße als angemeldet wird abgelehnt (HTTP ${tooBig.status})`);
    else
      warn(
        'R2 hat eine größere Datei als angemeldet angenommen – die API prüft die Größe nach dem Upload trotzdem.',
      );
    const typed = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: photo,
    });
    if (!typed.ok) ok(`Anderer Content-Type als angemeldet wird abgelehnt (HTTP ${typed.status})`);
    else fail('R2 hat einen anderen Content-Type als signiert angenommen.');

    // 5. Rohdatei ist ohne Signatur nicht lesbar (Bucket privat)
    const anonymous = await fetch(`${config.endpoint}/${config.bucket}/${rawKey}`);
    if (anonymous.status >= 400)
      ok(`Unverarbeiteter Upload ohne Signatur nicht abrufbar (HTTP ${anonymous.status})`);
    else
      fail(
        `Unverarbeiteter Upload ist ÖFFENTLICH abrufbar (HTTP ${anonymous.status}) – Bucket-Zugriff prüfen!`,
      );

    // 6. Verarbeiten wie die API: lesen, prüfen, EXIF entfernen, Varianten schreiben
    const raw = await storage.getBytes(rawKey, 15 * 1024 * 1024);
    const processed = await processImage(raw);
    for (const variant of processed.variants) {
      const key = `${prefix}/${variant.name}.webp`;
      await storage.put(
        key,
        variant.body,
        variant.contentType,
        'public, max-age=31536000, immutable',
      );
      created.push(key);
    }
    ok(
      `Verarbeitet: ${processed.width} × ${processed.height}, Varianten ${IMAGE_VARIANT_NAMES.join(', ')}`,
    );

    // 7. Ausliefern über signierte Lese-URL
    const download = await fetch(await storage.presignDownload(`${prefix}/thumb.webp`, 60));
    const body = Buffer.from(await download.arrayBuffer());
    const meta = download.ok ? await sharp(body).metadata() : null;
    if (meta?.format === 'webp' && !meta.exif)
      ok(`Vorschaubild abrufbar (${meta.width} × ${meta.height}, WebP, ohne EXIF)`);
    else fail(`Vorschaubild nicht korrekt abrufbar (HTTP ${download.status})`);

    // 8. CORS für Browser-Uploads vom Frontend
    if (setup) {
      try {
        await client.send(
          new PutBucketCorsCommand({
            Bucket: config.bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: [env.WEB_URL],
                  AllowedMethods: ['PUT', 'GET'],
                  AllowedHeaders: ['content-type'],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          }),
        );
        ok(`CORS-Regel für ${env.WEB_URL} gesetzt`);
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: config.bucket,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'marktat-abgebrochene-uploads',
                  Status: 'Enabled',
                  Filter: { Prefix: 'uploads/' },
                  Expiration: { Days: 1 },
                },
              ],
            },
          }),
        );
        ok('Aufräumregel gesetzt: uploads/ wird nach 1 Tag gelöscht');
      } catch (error) {
        warn(
          `Bucket-Einstellungen konnten nicht gesetzt werden: ${s3Error(error)} – bitte im Dashboard (docs/bilder.md).`,
        );
      }
    }
    const preflight = await fetch(upload.url, {
      method: 'OPTIONS',
      headers: {
        Origin: env.WEB_URL,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const allowed = preflight.headers.get('access-control-allow-origin');
    if (preflight.ok && (allowed === env.WEB_URL || allowed === '*'))
      ok(`CORS erlaubt Uploads von ${env.WEB_URL}`);
    else {
      fail(
        `CORS erlaubt keine Uploads von ${env.WEB_URL} (HTTP ${preflight.status}) – Browser-Uploads scheitern so.`,
      );
      warn(
        'CORS-Regel im Cloudflare-Dashboard eintragen (docs/bilder.md) oder `r2:check --setup` mit Admin-Token.',
      );
    }
  } catch (error) {
    fail(`Unerwarteter Fehler: ${s3Error(error)}`);
  } finally {
    await storage.deleteMany(created).then(
      () => ok('Testobjekte gelöscht'),
      (error) => warn(`Testobjekte unter ${prefix}/ bitte manuell löschen: ${s3Error(error)}`),
    );
  }

  console.log(
    failed ? '\nErgebnis: FEHLER – siehe oben.\n' : '\nErgebnis: R2 ist korrekt eingerichtet.\n',
  );
  if (failed) process.exitCode = 1;
}

await main();
