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
import { DealSearchService } from '../src/deals/deal-search.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { DEFAULT_PRODUCTS } from '../src/billing/pricing.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../src/billing/stripe.gateway.js';

let searchIndex: SearchIndexService | undefined;
let dealSearch: DealSearchService | undefined;
let jobs: JobsService | undefined;

/**
 * Test-App gegen die Testdatenbank und den Test-Suchindex.
 * `meiliUrl` überschreibt die Meilisearch-Adresse, z. B. eine nicht erreichbare für den Ausweichbetrieb;
 * `env` überschreibt weitere Umgebungsvariablen (z. B. REDIS_URL) nur für diese App.
 */
export async function createTestApp(options: { meiliUrl?: string; stripe?: StripeGateway; env?: Record<string, string> } = {}) {
  const overrides = { ...options.env, ...(options.meiliUrl !== undefined ? { MEILI_URL: options.meiliUrl } : {}) };
  const isolated = Object.keys(overrides).length > 0;
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  if (isolated) {
    Object.assign(process.env, overrides);
    resetEnvCache();
  }
  try {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    if (options.stripe) builder.overrideProvider(STRIPE_GATEWAY).useValue(options.stripe);
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    setupApp(app);
    await app.init();
    const index = app.get(SearchIndexService);
    await index.ensureReady();
    await app.get(DealSearchService).index.ensureReady();
    if (!isolated) {
      searchIndex = index;
      dealSearch = app.get(DealSearchService);
      jobs = app.get(JobsService);
    }
    return { app, prisma: app.get(PrismaService), searchIndex: index };
  } finally {
    if (isolated) {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetEnvCache();
    }
  }
}

/** Erzeugt ein Access-Token wie Supabase Auth es ausstellt (HS256, gleiche Claims). */
export async function tokenFor(
  user: { id?: string; email?: string; metadata?: Record<string, unknown>; claims?: Record<string, unknown> } = {},
) {
  const id = user.id ?? randomUUID();
  const email = user.email ?? `test-${id.slice(0, 8)}@example.at`;
  const token = await new SignJWT({
    email,
    role: 'authenticated',
    user_metadata: user.metadata ?? { display_name: 'Testperson' },
    ...user.claims,
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

/** Token derselben Person mit Sicherheitsniveau: aal2 mit TOTP-Bestätigung vor `mfaAgeSeconds` Sekunden */
export function mfaToken(account: { id: string; email: string }, mfaAgeSeconds: number | null) {
  const now = Math.floor(Date.now() / 1000);
  const claims =
    mfaAgeSeconds === null
      ? { aal: 'aal1', amr: [{ method: 'password', timestamp: now }] }
      : { aal: 'aal2', amr: [{ method: 'password', timestamp: now - mfaAgeSeconds }, { method: 'totp', timestamp: now - mfaAgeSeconds }] };
  return tokenFor({ id: account.id, email: account.email, claims });
}

/** Löscht alle Bewegungsdaten und den Test-Suchindex, Stammdaten (Geo, Kategorien) bleiben erhalten. */
export async function resetData(prisma: PrismaService) {
  await searchIndex?.flush();
  await dealSearch?.index.flush();
  await jobs?.drain().catch(() => jobs?.clear());
  await prisma.$executeRawUnsafe(
    'TRUNCATE error_events, audit_logs, notifications, appeals, report_events, reports, moderation_decisions, account_deletions, user_blocks, messages, conversations, favorites, saved_searches, listing_images, listing_view_days, payments, bookings, stripe_events, deal_price_records, deal_stores, deal_imports, deals, deal_feeds, dealer_stores, service_qualifications, service_portfolio_items, service_profile_categories, service_projects, service_profiles, listings, users CASCADE',
  );
  await restoreBillingDefaults(prisma);
  await searchIndex?.clear();
  await dealSearch?.index.clear();
}

/** Leistungen und Einstellungen auf die Startkonfiguration zurücksetzen (alles kostenlos). */
export async function restoreBillingDefaults(prisma: PrismaService) {
  await prisma.product.deleteMany({});
  await prisma.platformSettings.deleteMany({});
  await prisma.product.createMany({ data: DEFAULT_PRODUCTS.map((p) => ({ ...p })) });
  await prisma.platformSettings.create({ data: { id: 1 } });
}

/** Wartet, bis alle Änderungen im Suchindex angekommen sind (die API aktualisiert ihn im Hintergrund). */
export async function flushSearch() {
  await searchIndex?.flush();
  await dealSearch?.index.flush();
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

/** Konto mit Rolle (Rollen gibt es nur in der Datenbank – genau wie in Produktion über admin:role) */
export async function signInAs(
  app: NestExpressApplication,
  role: 'USER' | 'MODERATOR' | 'ADMIN',
  user?: Parameters<typeof tokenFor>[0],
) {
  const account = await signIn(app, user);
  await app.get(PrismaService).user.update({ where: { id: account.id }, data: { role } });
  return account;
}

/** IDs im Test-Suchindex */
export async function indexedIds(index: SearchIndexService): Promise<string[]> {
  await index.flush();
  const page = await index.client!.getDocumentIds(index.indexUid, 0, 1000);
  return page.results.map((doc) => doc.id);
}

/** Gewerbliches Konto mit vollständigem Händlerprofil und Bestätigung (Art. 30 DSA) – darf Deals veröffentlichen */
export async function signInMerchant(app: NestExpressApplication, company = 'Elektro Huber GmbH') {
  const account = await signIn(app, { metadata: { display_name: company, account_type: 'BUSINESS', company_name: company } });
  await request(app.getHttpServer())
    .patch('/v1/me')
    .set(account.auth)
    .send({ companyAddress: 'Annenstraße 1, 8020 Graz', phone: '+43 316 123456' })
    .expect(200);
  await request(app.getHttpServer()).post('/v1/me/dealer-certification').set(account.auth).send({ confirmed: true }).expect(200);
  return account;
}

/** Kalendertag in Wien, relativ zu heute */
export function viennaDayOffset(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Veröffentlicht einen Online-Deal (Laptop, UVP-Vergleich) und gibt die API-Antwort zurück */
export async function publishDeal(app: NestExpressApplication, auth: Record<string, string>, overrides: Record<string, unknown> = {}) {
  const res = await request(app.getHttpServer())
    .post('/v1/me/deals')
    .set(auth)
    .send({
      publish: true,
      title: 'Notebook 15 Zoll, 16 GB RAM',
      description: 'Aktionspreis solange der Vorrat reicht.',
      categorySlug: 'elektronik-computer',
      channel: 'ONLINE',
      url: 'https://shop.example.at/notebook-15',
      priceCents: 59_900,
      referencePriceCents: 79_900,
      referencePriceType: 'RRP',
      referencePriceSource: 'UVP laut Hersteller, Preisliste 10/2026',
      referenceConfirmed: true,
      startsOn: viennaDayOffset(0),
      endsOn: viennaDayOffset(14),
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`Deal nicht angelegt: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; title: string; discountPercent: number | null; status: string };
}
