import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { createTestApp, tokenFor } from './helpers.js';

/**
 * Foto-Assistent gegen einen lokalen Testserver mit der Schnittstelle der Claude-API (kein Internet, kein Schlüssel).
 * Geprüft wird der ganze Weg: Rohdaten-Upload, Verkleinern, Anfrage an die API, Prüfung der Vorschläge, Limits.
 */
describe('Foto-Assistent', () => {
  let fake: Server;
  let base: string;
  let app: NestExpressApplication;
  const received: { path: string; headers: IncomingMessage['headers']; body: Record<string, any> }[] = [];
  let reply: Record<string, unknown> = {};
  let stopReason = 'end_turn';

  const photo = () => sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a7' } }).png().toBuffer();

  beforeAll(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: stopReason === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(reply) }],
            stop_reason: stopReason,
            stop_sequence: null,
            usage: { input_tokens: 1800, output_tokens: 120, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    ({ app } = await createTestApp({
      env: { AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-test-0123456789', ANTHROPIC_BASE_URL: base, AI_AUTOFILL_USER_DAILY_LIMIT: '3' },
    }));
  });
  beforeEach(() => {
    received.length = 0;
    stopReason = 'end_turn';
    reply = {
      recognized: true,
      categoryPath: 'marktplatz/computer-software/pc-komponenten/grafikkarten',
      title: 'ASUS Dual GeForce RTX 4070 Super 12 GB',
      description: 'Grafikkarte ASUS Dual GeForce RTX 4070 Super mit 12 GB GDDR6X. Originalverpackung.',
      condition: 'LIKE_NEW',
      attributes: [
        { key: 'chipMaker', value: 'nvidia' },
        { key: 'chipModel', value: 'GeForce RTX 4070 Super' },
        { key: 'vramGb', value: '12' },
        { key: 'brand', value: 'ASUS' },
        { key: 'mileageKm', value: '85000' },
      ],
    };
  });
  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => fake.close(resolve));
  });

  const server = () => app.getHttpServer();

  it('meldet, dass der Assistent eingeschaltet ist (ohne Anmeldung)', async () => {
    await request(server()).get('/v1/autofill/status').expect(200, { enabled: true });
  });

  it('schlägt aus einem Foto Kategorie, Titel, Beschreibung, Zustand und Zusatzangaben vor', async () => {
    const { auth } = await tokenFor();
    const res = await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(200);

    expect(res.body).toMatchObject({
      recognized: true,
      categoryPath: 'marktplatz/computer-software/pc-komponenten/grafikkarten',
      title: 'ASUS Dual GeForce RTX 4070 Super 12 GB',
      condition: 'LIKE_NEW',
      // Felder fremder Kategorien (Kilometerstand) fallen weg
      attributes: { chipMaker: 'nvidia', chipModel: 'GeForce RTX 4070 Super', vramGb: '12', brand: 'ASUS' },
    });
    expect(res.body.categoryId).toEqual(expect.any(String));

    // An die Claude-API geht ein verkleinertes JPEG, der Prompt kennt Kategorien und Felder
    expect(received).toHaveLength(1);
    const { body, headers } = received[0]!;
    expect(`${headers['x-api-key'] ?? ''}${headers.authorization ?? ''}`).toContain('sk-ant-test-0123456789');
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.fallbacks).toBe('default');
    const image = body.messages[0].content[0];
    expect(image.source.media_type).toBe('image/jpeg');
    expect((await sharp(Buffer.from(image.source.data, 'base64')).metadata()).format).toBe('jpeg');
    const system = body.system[0];
    expect(system.cache_control).toEqual({ type: 'ephemeral' });
    expect(system.text).toContain('marktplatz/computer-software/pc-komponenten/grafikkarten | ');
    expect(system.text).toMatch(/F\d+: vramGb – Grafikspeicher \(Auswahl\): 1=1 GB/);
  });

  it('verwirft unbekannte Kategorien und gibt bei nicht erkannten Fotos leere Vorschläge', async () => {
    const { auth } = await tokenFor();
    reply = { ...reply, categoryPath: 'marktplatz/gibt-es-nicht' };
    const unknown = await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(200);
    expect(unknown.body).toMatchObject({ recognized: true, categoryId: null, condition: null, attributes: {}, title: 'ASUS Dual GeForce RTX 4070 Super 12 GB' });

    reply = { recognized: false, categoryPath: '', title: '', description: '', condition: '', attributes: [] };
    const nothing = await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(200);
    expect(nothing.body).toEqual({ recognized: false, categoryId: null, categoryPath: null, title: '', description: '', condition: null, attributes: {} });
  });

  it('lehnt Gäste, Nicht-Bilder und zu kleine Fotos ab', async () => {
    await request(server()).post('/v1/autofill/listing').set('Content-Type', 'image/png').send(await photo()).expect(401);
    const { auth } = await tokenFor();
    await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(Buffer.from('kein Bild')).expect(400);
    const tiny = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#000' } }).png().toBuffer();
    await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(tiny).expect(400);
    await request(server()).post('/v1/autofill/listing').set(auth).send({ image: 'base64' }).expect(400);
    expect(received).toHaveLength(0);
  });

  it('meldet abgelehnte Fotos verständlich', async () => {
    const { auth } = await tokenFor();
    stopReason = 'refusal';
    const res = await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(422);
    expect(res.body.message).toContain('nicht auswerten');
  });

  it('begrenzt die Auswertungen je Konto und Tag', async () => {
    const { auth } = await tokenFor();
    for (let i = 0; i < 3; i++) {
      await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(200);
    }
    const res = await request(server()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(429);
    expect(res.body.message).toContain('heute');
    expect(received).toHaveLength(3);
  });

  it('ist ohne Schlüssel abgeschaltet', async () => {
    const { app: off } = await createTestApp({ env: { AI_ENABLED: 'true', ANTHROPIC_API_KEY: '' } });
    try {
      await request(off.getHttpServer()).get('/v1/autofill/status').expect(200, { enabled: false });
      const { auth } = await tokenFor();
      await request(off.getHttpServer()).post('/v1/autofill/listing').set(auth).set('Content-Type', 'image/png').send(await photo()).expect(503);
    } finally {
      await off.close();
    }
  });
});
