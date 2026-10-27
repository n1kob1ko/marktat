import { rm } from 'node:fs/promises';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, flushSearch, resetData, tokenFor } from './helpers.js';

/** Signierte URLs zeigen auf API_URL; im Test gehen sie direkt an die Test-App. */
const pathOf = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

async function photo(width = 900, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 80 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Artist: 'Geheime Person' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 12/1 30/1' },
    })
    .toBuffer();
}

describe('Inseratsbilder', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let categoryId: string;
  let locationId: number;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    categoryId = (
      await prisma.category.findUniqueOrThrow({
        where: { path: 'marktplatz/sport-freizeit/fahrraeder' },
      })
    ).id;
    locationId = (await prisma.location.findFirstOrThrow({ where: { postalCode: '8010', place: 'Graz' } })).id;
  });
  beforeEach(async () => {
    await resetData(prisma);
    await rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true });
  });
  afterAll(() => app.close());

  async function createListing(auth: Record<string, string>, publish = true) {
    const body = publish
      ? {
          publish,
          title: 'Trekkingrad 28"',
          description: 'Gut erhaltenes Trekkingrad mit neuen Reifen.',
          categoryId,
          priceType: 'FIXED',
          priceCents: 25_000,
          locationId,
        }
      : { publish, title: 'Entwurf mit Bild' };
    const res = await request(server()).post('/v1/listings').set(auth).send(body).expect(201);
    return res.body.id as string;
  }

  /** Kompletter Ablauf wie im Browser: anmelden → PUT an die signierte URL → abschließen. */
  async function upload(
    auth: Record<string, string>,
    listingId: string,
    file: Buffer,
    contentType = 'image/jpeg',
  ) {
    const ticket = await request(server())
      .post(`/v1/listings/${listingId}/images/uploads`)
      .set(auth)
      .send({ contentType, size: file.length })
      .expect(201);
    await request(server())
      .put(pathOf(ticket.body.uploadUrl))
      .set(ticket.body.headers)
      .send(file)
      .expect(200);
    return {
      ticket: ticket.body,
      complete: () =>
        request(server())
          .post(`/v1/listings/${listingId}/images/${ticket.body.imageId}/complete`)
          .set(auth),
    };
  }

  it('lädt hoch, entfernt Metadaten und liefert nur verarbeitete Varianten aus', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const { ticket, complete } = await upload(seller.auth, listingId, await photo());
    expect(ticket).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });

    // Vor dem Abschluss ist nichts öffentlich erreichbar
    await request(server()).get(`/v1/images/${ticket.imageId}/large`).expect(404);
    const detailBefore = await request(server()).get(`/v1/listings/${listingId}`).expect(200);
    expect(detailBefore.body.images).toEqual([]);

    const done = await complete().expect(200);
    expect(done.body).toMatchObject({ id: ticket.imageId, width: 600, height: 900, position: 0 });

    const detail = await request(server()).get(`/v1/listings/${listingId}`).expect(200);
    expect(detail.body.images).toHaveLength(1);
    expect(detail.body.images[0].url).toBe(
      `http://localhost:4000/v1/images/${ticket.imageId}/large`,
    );
    expect(detail.body.imageUrl).toBe(`http://localhost:4000/v1/images/${ticket.imageId}/thumb`);
    await flushSearch();
    const list = await request(server()).get('/v1/listings').expect(200);
    expect(list.body.items[0].imageUrl).toBe(detail.body.imageUrl);

    for (const variant of ['large', 'thumb']) {
      const redirect = await request(server())
        .get(`/v1/images/${ticket.imageId}/${variant}`)
        .expect(302);
      expect(redirect.headers['cache-control']).toBe('public, max-age=1800');
      const file = await request(server())
        .get(pathOf(redirect.headers.location!))
        .buffer(true)
        .expect(200);
      expect(file.headers['content-type']).toBe('image/webp');
      const meta = await sharp(file.body as Buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect((file.body as Buffer).includes(Buffer.from('Geheime Person'))).toBe(false);
    }
    await request(server()).get(`/v1/images/${ticket.imageId}/original`).expect(404);

    // Die Rohdatei ist gelöscht und war nie über eine Lese-URL erreichbar
    const row = await prisma.listingImage.findUniqueOrThrow({ where: { id: ticket.imageId } });
    expect(row).toMatchObject({ status: 'READY', uploadKey: null, detectedType: 'image/jpeg' });
    await request(server()).get(pathOf(ticket.uploadUrl)).expect(403);
  });

  it('prüft Typ und Größe schon bei der Anmeldung', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const url = `/v1/listings/${listingId}/images/uploads`;
    const gif = await request(server())
      .post(url)
      .set(seller.auth)
      .send({ contentType: 'image/gif', size: 1000 })
      .expect(400);
    expect(gif.body.errors[0].message).toBe('Erlaubt sind nur JPEG, PNG oder WebP.');
    const big = await request(server())
      .post(url)
      .set(seller.auth)
      .send({ contentType: 'image/png', size: 15 * 1024 * 1024 + 1 })
      .expect(400);
    expect(big.body.errors[0].message).toBe('Ein Bild darf höchstens 15 MB groß sein.');
  });

  it('lehnt Dateien ab, die keine Bilder sind, und räumt sie weg', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const fake = Buffer.from('<?php echo "kein Bild"; ?>'.repeat(50));
    const { ticket, complete } = await upload(seller.auth, listingId, fake, 'image/jpeg');
    const res = await complete().expect(422);
    expect(res.body.message).toBe('Die Datei ist kein lesbares Bild.');
    expect(await prisma.listingImage.count({ where: { id: ticket.imageId } })).toBe(0);
    await request(server()).get(`/v1/images/${ticket.imageId}/large`).expect(404);
  });

  it('erzwingt die signierte Größe und den signierten Typ beim Upload', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const file = await photo();
    const ticket = await request(server())
      .post(`/v1/listings/${listingId}/images/uploads`)
      .set(seller.auth)
      .send({ contentType: 'image/jpeg', size: file.length })
      .expect(201);
    const target = pathOf(ticket.body.uploadUrl);
    await request(server())
      .put(target)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([file, Buffer.alloc(10)]))
      .expect(403);
    await request(server()).put(target).set('Content-Type', 'image/png').send(file).expect(403);
    await request(server())
      .put(`${target.slice(0, -3)}abc`)
      .set('Content-Type', 'image/jpeg')
      .send(file)
      .expect(403);
    // Ohne erfolgreichen Upload lässt sich nichts abschließen
    await request(server())
      .post(`/v1/listings/${listingId}/images/${ticket.body.imageId}/complete`)
      .set(seller.auth)
      .expect(409);
  });

  it('erlaubt höchstens 10 Bilder je Inserat (laufende Uploads zählen mit)', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const url = `/v1/listings/${listingId}/images/uploads`;
    for (let i = 0; i < 10; i += 1) {
      await request(server())
        .post(url)
        .set(seller.auth)
        .send({ contentType: 'image/webp', size: 5000 })
        .expect(201);
    }
    const res = await request(server())
      .post(url)
      .set(seller.auth)
      .send({ contentType: 'image/webp', size: 5000 })
      .expect(409);
    expect(res.body.message).toBe('Ein Inserat kann höchstens 10 Bilder haben.');

    // Abgebrochene Uploads verfallen nach einer Stunde und geben den Platz frei
    await prisma.listingImage.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await request(server())
      .post(url)
      .set(seller.auth)
      .send({ contentType: 'image/webp', size: 5000 })
      .expect(201);
    expect(await prisma.listingImage.count({ where: { listingId } })).toBe(1);
  });

  it('setzt Hauptbild und Reihenfolge und löscht einzelne Bilder', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth);
    const ids: string[] = [];
    for (const width of [800, 900, 1000]) {
      const { ticket, complete } = await upload(seller.auth, listingId, await photo(width, 600));
      await complete().expect(200);
      ids.push(ticket.imageId);
    }
    const base = `/v1/listings/${listingId}/images`;
    let images = await request(server()).get(base).set(seller.auth).expect(200);
    expect(images.body.map((i: { id: string }) => i.id)).toEqual(ids);

    images = await request(server()).post(`${base}/${ids[2]}/main`).set(seller.auth).expect(200);
    expect(images.body.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    const detail = await request(server()).get(`/v1/listings/${listingId}`).expect(200);
    expect(detail.body.imageUrl).toContain(`/images/${ids[2]}/thumb`);

    images = await request(server())
      .put(`${base}/order`)
      .set(seller.auth)
      .send({ imageIds: [ids[1], ids[2], ids[0]] })
      .expect(200);
    expect(images.body.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([
      [ids[1], 0],
      [ids[2], 1],
      [ids[0], 2],
    ]);
    await request(server())
      .put(`${base}/order`)
      .set(seller.auth)
      .send({ imageIds: [ids[1], ids[2]] })
      .expect(400);
    await request(server())
      .put(`${base}/order`)
      .set(seller.auth)
      .send({ imageIds: [ids[1], ids[1], ids[0]] })
      .expect(400);

    await request(server()).delete(`${base}/${ids[1]}`).set(seller.auth).expect(204);
    images = await request(server()).get(base).set(seller.auth).expect(200);
    expect(images.body.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([
      [ids[2], 0],
      [ids[0], 1],
    ]);
    await request(server()).get(`/v1/images/${ids[1]}/large`).expect(404);
  });

  it('lässt nur den Eigentümer Bilder verwalten', async () => {
    const seller = await tokenFor();
    const other = await tokenFor();
    const listingId = await createListing(seller.auth);
    const { ticket, complete } = await upload(seller.auth, listingId, await photo());
    await complete().expect(200);
    const base = `/v1/listings/${listingId}/images`;

    await request(server())
      .post(`${base}/uploads`)
      .send({ contentType: 'image/jpeg', size: 100 })
      .expect(401);
    await request(server())
      .post(`${base}/uploads`)
      .set(other.auth)
      .send({ contentType: 'image/jpeg', size: 100 })
      .expect(404);
    await request(server()).get(base).set(other.auth).expect(404);
    await request(server()).post(`${base}/${ticket.imageId}/complete`).set(other.auth).expect(404);
    await request(server()).post(`${base}/${ticket.imageId}/main`).set(other.auth).expect(404);
    await request(server())
      .put(`${base}/order`)
      .set(other.auth)
      .send({ imageIds: [ticket.imageId] })
      .expect(404);
    await request(server()).delete(`${base}/${ticket.imageId}`).set(other.auth).expect(404);
    expect(await prisma.listingImage.count()).toBe(1);

    // Bild-ID eines anderen Inserats wird nicht angenommen
    const ownListing = await createListing(other.auth);
    await request(server())
      .delete(`/v1/listings/${ownListing}/images/${ticket.imageId}`)
      .set(other.auth)
      .expect(404);
  });

  it('zeigt Bilder nicht öffentlicher Inserate nur über signierte URLs', async () => {
    const seller = await tokenFor();
    const listingId = await createListing(seller.auth, false);
    const { ticket, complete } = await upload(seller.auth, listingId, await photo());
    const done = await complete().expect(200);
    expect(done.body.url).toMatch(/\?exp=\d+&sig=/);

    await request(server()).get(`/v1/images/${ticket.imageId}/large`).expect(404);
    const signed = await request(server()).get(pathOf(done.body.url)).expect(302);
    expect(signed.headers['cache-control']).toBe('private, max-age=1800');
    await request(server())
      .get(`${pathOf(done.body.url)}x`)
      .expect(404);
    await request(server()).get(pathOf(done.body.url).replace('/large?', '/thumb?')).expect(404);

    const mine = await request(server()).get('/v1/listings/mine').set(seller.auth).expect(200);
    expect(mine.body[0].imageUrl).toMatch(/\/thumb\?exp=\d+&sig=/);

    // Gelöschte Inserate liefern ihre Bilder gar nicht mehr aus
    await request(server()).delete(`/v1/listings/${listingId}`).set(seller.auth).expect(204);
    await request(server()).get(pathOf(done.body.url)).expect(404);
  });
});
