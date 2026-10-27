import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { resetEnvCache } from '../src/config/env.js';
import { setupApp } from '../src/setup-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SearchIndexService } from '../src/search/search-index.service.js';

let searchIndex: SearchIndexService | undefined;

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
    if (options.meiliUrl === undefined) searchIndex = index;
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
  await prisma.$executeRawUnsafe('TRUNCATE audit_logs, listing_images, listings, users CASCADE');
  await searchIndex?.clear();
}

/** Wartet, bis alle Änderungen im Suchindex angekommen sind (die API aktualisiert ihn im Hintergrund). */
export async function flushSearch() {
  await searchIndex?.flush();
}
