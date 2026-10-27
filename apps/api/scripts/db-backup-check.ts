/**
 * Probelauf für Sicherung und Wiederherstellung – ausschließlich mit synthetischen Daten in eigenen,
 * temporären Datenbanken. Entwicklungs- und Testdatenbank werden nicht angefasst.
 *
 *   pnpm --filter @marktat/api db:backup-check
 *
 * Ablauf: Quelldatenbank anlegen → alle Migrationen → synthetische Daten (inkl. PostGIS-Spalte) →
 * pg_dump → pg_restore in eine zweite Datenbank → Zeilenzahl und Prüfsumme jeder Tabelle vergleichen →
 * beide temporären Datenbanken wieder löschen (mit --keep bleiben sie zur Ansicht erhalten).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { inDb, PG_USER, REPO_ROOT, sql, timestamp } from './lib/pg-docker.js';
import { restore } from './db-restore.js';

const { values } = parseArgs({ args: process.argv.slice(2).filter((arg) => arg !== '--'), options: { keep: { type: 'boolean' } } });

const suffix = timestamp().toLowerCase().replace(/-/g, '');
const source = `marktat_restorecheck_src_${suffix}`;
const target = `marktat_restorecheck_dst_${suffix}`;
const baseUrl = new URL(process.env.DATABASE_URL ?? `postgresql://${PG_USER}@localhost:5433/marktat`);
const urlFor = (db: string) => Object.assign(new URL(baseUrl), { pathname: `/${db}` }).toString();
const workDir = mkdtempSync(join(tmpdir(), 'marktat-backup-check-'));
const dumpFile = join(workDir, `${source}.dump`);

async function seedSynthetic(url: string) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.state.create({ data: { id: 6, code: 'ST', slug: 'steiermark', name: 'Steiermark' } });
    await prisma.district.create({ data: { id: 601, stateId: 6, slug: 'graz', name: 'Graz (Stadt)' } });
    const location = await prisma.location.create({
      data: { postalCode: '8010', place: 'Graz', slug: 'graz', districtId: 601, latitude: 47.0707, longitude: 15.4395 },
    });
    await prisma.$executeRaw`UPDATE locations SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE id = ${location.id}`;
    const category = await prisma.category.create({ data: { vertical: 'MARKETPLACE', slug: 'fahrraeder', path: 'marktplatz/fahrraeder', name: 'Fahrräder' } });
    const users = await Promise.all(
      ['verkauf', 'kauf', 'moderation'].map((name, i) =>
        prisma.user.create({
          data: {
            id: `00000000-0000-4000-8000-00000000000${i + 1}`,
            email: `${name}@beispiel.invalid`,
            displayName: `Synthetisch ${name}`,
            role: name === 'moderation' ? 'MODERATOR' : 'USER',
          },
        }),
      ),
    );
    const [seller, buyer] = users as [(typeof users)[0], (typeof users)[0]];
    for (let i = 1; i <= 25; i++) {
      await prisma.listing.create({
        data: {
          sellerId: seller.id,
          title: `Synthetisches Rad ${i} – „Umlaute“ äöüß`,
          slug: `synthetisches-rad-${i}`,
          description: 'Nur Testdaten für den Wiederherstellungstest.\nZweite Zeile mit Emoji 🚲',
          categoryId: category.id,
          priceType: 'FIXED',
          priceCents: BigInt(i * 1_000_00),
          condition: 'GOOD',
          locationId: location.id,
          attributes: { rahmengroesse: 50 + i },
          status: i % 5 === 0 ? 'DRAFT' : 'ACTIVE',
          publishedAt: i % 5 === 0 ? null : new Date('2026-10-01T10:00:00Z'),
          expiresAt: new Date('2026-12-01T10:00:00Z'),
        },
      });
    }
    const listing = await prisma.listing.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const conversation = await prisma.conversation.create({ data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id } });
    for (let i = 0; i < 10; i++) {
      const from = i % 2 ? seller : buyer;
      const to = i % 2 ? buyer : seller;
      await prisma.message.create({ data: { conversationId: conversation.id, senderId: from.id, recipientId: to.id, body: `Nachricht ${i}` } });
    }
    await prisma.auditLog.create({ data: { action: 'restore_check.synthetic', actorId: seller.id, metadata: { note: 'synthetisch' } } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Zeilenzahl und Prüfsumme über den gesamten Inhalt jeder Tabelle (Schema public) */
async function fingerprint(db: string): Promise<Map<string, string>> {
  const tables = (await sql(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).trim().split('\n').filter(Boolean);
  const result = new Map<string, string>();
  for (const table of tables) {
    const row = await sql(db, `SELECT count(*) || ':' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '-') FROM "${table}" t`);
    result.set(table, row.trim());
  }
  return result;
}

let failed = false;
try {
  console.log(`1/5 Quelldatenbank ${source} anlegen und migrieren`);
  await sql('postgres', `CREATE DATABASE ${source}`);
  await sql(source, 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: `${REPO_ROOT}apps/api`,
    env: { ...process.env, DATABASE_URL: urlFor(source) },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  console.log('2/5 Synthetische Daten einfügen');
  await seedSynthetic(urlFor(source));

  console.log('3/5 Sicherung mit pg_dump');
  await inDb(['pg_dump', '-U', PG_USER, '-d', source, '-Fc', '--no-owner', '--no-privileges'], { stdoutFile: dumpFile });
  console.log(`    ${(statSync(dumpFile).size / 1024).toFixed(0)} KB`);

  console.log(`4/5 Wiederherstellung in ${target}`);
  const started = Date.now();
  await restore(dumpFile, target);
  console.log(`    ${((Date.now() - started) / 1000).toFixed(1)} s`);

  console.log('5/5 Vergleich');
  const [before, after] = await Promise.all([fingerprint(source), fingerprint(target)]);
  for (const [table, value] of before) {
    const ok = after.get(table) === value;
    if (!ok) failed = true;
    const rows = value.split(':')[0];
    if (!ok || rows !== '0') console.log(`    ${ok ? 'gleich ' : 'ABWEICHUNG'} ${table} (${rows} Zeilen)`);
  }
  if (after.size !== before.size) failed = true;
  const geom = await sql(target, 'SELECT ST_AsText(geom::geometry) FROM locations LIMIT 1');
  console.log(`    PostGIS-Spalte nach Wiederherstellung: ${geom.trim()}`);
  console.log(failed ? 'FEHLER: Wiederherstellung weicht ab.' : `OK: ${before.size} Tabellen identisch wiederhergestellt.`);
} catch (error) {
  failed = true;
  console.error(`FEHLER: ${(error as Error).message}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
  if (!values.keep) {
    for (const db of [source, target]) await sql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
  } else {
    console.log(`Behalten: ${source}, ${target}`);
  }
}
process.exitCode = failed ? 1 : 0;
