import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { resetEnvCache } from '../src/config/env.js';
import { setupApp } from '../src/setup-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SearchIndexService } from '../src/search/search-index.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';

let searchIndex: SearchIndexService | undefined;
let jobs: JobsService | undefined;

/**
 * Test-App gegen die Testdatenbank und den Test-Suchindex.
 * `meiliUrl` überschreibt die Meilisearch-Adresse, z. B. eine nicht erreichbare für den Ausweichbetrieb.
 */
export async function createTestApp(options: { meiliUrl?: string } = {}) {
  const original = process.env.MEILI_URL;
  if (options.meiliUrl !== undefined) {
    process.env.MEILI_URL = options.meiliUrl;
    resetEnvCache();
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    setupApp(app);
    await app.init();
    const index = app.get(SearchIndexService);
    await index.ensureReady();
    if (options.meiliUrl === undefined) {
      searchIndex = index;
      jobs = app.get(JobsService);
    }
    return { app, prisma: app.get(PrismaService), searchIndex: index };
  } finally {
    if (options.meiliUrl !== undefined) {
      process.env.MEILI_URL = original;
      resetEnvCache();
    }
  }
}

/** Erzeugt ein Access-Token wie Supabase Auth es ausstellt (HS256, gleiche Claims). */
export async function tokenFor(
  user: { id?: string; email?: string; metadata?: Record<string, unknown> } = {},
) {
  const id = user.id ?? randomUUID();
  const email = user.email ?? `test-${id.slice(0, 8)}@example.at`;
  const token = await new SignJWT({
    email,
    role: 'authenticated',
    user_metadata: user.metadata ?? { display_name: 'Testperson' },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(id)
    .setAudience('authenticated')
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
  return { id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Löscht alle Bewegungsdaten und den Test-Suchindex, Stammdaten (Geo, Kategorien) bleiben erhalten. */
export async function resetData(prisma: PrismaService) {
  await searchIndex?.flush();
  await jobs?.drain().catch(() => jobs?.clear());
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, user_reports, user_blocks, messages, conversations, favorites, saved_searches, listing_images, listings, users CASCADE',
  );
  await searchIndex?.clear();
}

/** Wartet, bis alle Änderungen im Suchindex angekommen sind (die API aktualisiert ihn im Hintergrund). */
export async function flushSearch() {
  await searchIndex?.flush();
}

/** Wartet, bis alle Hintergrundaufträge (z. B. E-Mails) erledigt sind. */
export async function drainJobs() {
  await jobs?.drain();
}

const MAILPIT_URL = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** E-Mails an eine Adresse aus Mailpit (`pnpm infra:up`). Testadressen sind eindeutig, daher kein Leeren nötig. */
export async function mailsTo(address: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit nicht erreichbar (${res.status})`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

/** Text einer E-Mail aus Mailpit */
export async function mailText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const body = (await res.json()) as { Text: string };
  return body.Text;
}

/** Veröffentlicht ein vollständiges Inserat (Fahrrad in Graz) und gibt die API-Antwort zurück. */
export async function publishListing(
  app: NestExpressApplication,
  auth: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; title: string; sellerId?: string }> {
  const prisma = app.get(PrismaService);
  const category = await prisma.category.findUniqueOrThrow({ where: { path: 'marktplatz/sport-freizeit/fahrraeder' } });
  const location = await prisma.location.findFirstOrThrow({ where: { postalCode: '8010', place: 'Graz' } });
  const res = await request(app.getHttpServer())
    .post('/v1/listings')
    .set(auth)
    .send({
      publish: true,
      title: 'Rennrad Carbon 56 cm',
      description: 'Sehr leichtes Rennrad, Shimano 105, regelmäßig gewartet.',
      categoryId: category.id,
      priceType: 'NEGOTIABLE',
      priceCents: 89_000,
      condition: 'GOOD',
      locationId: location.id,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`Inserat nicht angelegt: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Legt das Konto an (die API übernimmt Konten beim ersten Aufruf aus dem Token). */
export async function signIn(app: NestExpressApplication, user?: Parameters<typeof tokenFor>[0]) {
  const account = await tokenFor(user);
  await request(app.getHttpServer()).get('/v1/me').set(account.auth).expect(200);
  return account;
}
