/**
 * Stammdaten-Seed: Bundesländer, Bezirke, vollständiges Ortsverzeichnis (GeoNames) und Kategorien.
 * Idempotent – kann beliebig oft ausgeführt werden.
 *
 *   pnpm db:seed           Stammdaten
 *   pnpm db:seed -- --demo zusätzlich klar gekennzeichnete Demo-Inserate (nur Entwicklung)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEAL_CATEGORIES, LEGACY_CATEGORY_PATHS, SERVICE_CATEGORIES, STATES, slugify, VERTICAL_SLUGS, type Vertical } from '@marktat/shared';
import { createPrismaClient } from '../../src/prisma/create-client.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { CATEGORY_TREE, type CategorySeed } from './categories.js';
import { DISTRICTS } from './districts.js';
import { readDataset, upsertLocations } from './geo-dataset.js';
import { seedDemoData } from './demo.js';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function seedGeo(prisma: PrismaClient) {
  for (const [index, state] of STATES.entries()) {
    const id = index + 1;
    await prisma.state.upsert({
      where: { id },
      update: { code: state.code, slug: state.slug, name: state.name },
      create: { id, code: state.code, slug: state.slug, name: state.name },
    });
  }
  for (const d of DISTRICTS) {
    const data = { stateId: d.stateId, name: d.name, slug: slugify(d.name) };
    await prisma.district.upsert({ where: { id: d.id }, update: data, create: { id: d.id, ...data } });
  }
  const locations = readDataset();
  await upsertLocations(prisma, locations);
  console.log(`Geo: ${STATES.length} Bundesländer, ${DISTRICTS.length} Bezirke, ${locations.length} Orte`);
}

async function seedCategoryLevel(
  prisma: PrismaClient,
  vertical: Vertical,
  nodes: CategorySeed[],
  parent: { id: string; path: string } | null,
  seeded: Set<string>,
): Promise<number> {
  let count = 0;
  for (const [sortOrder, node] of nodes.entries()) {
    const slug = slugify(node.name);
    const path = `${parent?.path ?? VERTICAL_SLUGS[vertical]}/${slug}`;
    const data = {
      name: node.name,
      slug,
      vertical,
      icon: node.icon ?? null,
      sortOrder,
      parentId: parent?.id ?? null,
      isActive: true,
    };
    const category = await prisma.category.upsert({
      where: { path },
      update: data,
      create: { path, ...data },
    });
    count += 1;
    seeded.add(path);
    if (node.children) {
      count += await seedCategoryLevel(prisma, vertical, node.children, { id: category.id, path }, seeded);
    }
  }
  return count;
}

/**
 * Umbau des Kategoriebaums: Inserate aus alten Kategorien in die neuen umziehen (LEGACY_CATEGORY_PATHS),
 * danach alle Kategorien, die nicht mehr im Baum stehen, deaktivieren (nie löschen – Verlauf und alte Links).
 * Gespeicherte Suchen mit alten Pfaden übersetzt die API beim Suchen. Der Suchindex zieht beim nächsten Start
 * der API nach (geänderte Inserate, neue Dokumentversion).
 */
async function retireOldCategories(prisma: PrismaClient, seeded: Set<string>) {
  let moved = 0;
  for (const [from, to] of Object.entries(LEGACY_CATEGORY_PATHS)) {
    if (seeded.has(from)) continue;
    const [oldCategory, newCategory] = await Promise.all([
      prisma.category.findUnique({ where: { path: from }, select: { id: true } }),
      prisma.category.findUnique({ where: { path: to }, select: { id: true } }),
    ]);
    if (!oldCategory) continue;
    if (!newCategory) throw new Error(`Kategorie ${to} (Ersatz für ${from}) fehlt im Kategoriebaum.`);
    const { count } = await prisma.listing.updateMany({ where: { categoryId: oldCategory.id }, data: { categoryId: newCategory.id } });
    moved += count;
  }
  const { count: retired } = await prisma.category.updateMany({ where: { path: { notIn: [...seeded] }, isActive: true }, data: { isActive: false } });
  if (moved || retired) console.log(`Kategorien umgebaut: ${moved} Inserate umgezogen, ${retired} alte Kategorien deaktiviert`);
}

/** Kategorien der Deals (Phase 10) – Schlüssel ist der Slug; entfernte Einträge werden nur deaktiviert. */
async function seedDealCategories(prisma: PrismaClient) {
  for (const [sortOrder, category] of DEAL_CATEGORIES.entries()) {
    const data = { name: category.name, icon: category.icon, sortOrder, isActive: true, relatedCategoryPath: category.relatedCategoryPath ?? null };
    await prisma.dealCategory.upsert({ where: { slug: category.slug }, update: data, create: { slug: category.slug, ...data } });
  }
  await prisma.dealCategory.updateMany({ where: { slug: { notIn: DEAL_CATEGORIES.map((c) => c.slug) } }, data: { isActive: false } });
  console.log(`Deal-Kategorien: ${DEAL_CATEGORIES.length}`);
}

/** Kategorien der Dienstleistungen (Phase 10) – wie bei den Deals über den Slug, entfernte nur deaktiviert. */
async function seedServiceCategories(prisma: PrismaClient) {
  for (const [sortOrder, category] of SERVICE_CATEGORIES.entries()) {
    const data = {
      name: category.name,
      groupSlug: category.group.slug,
      groupName: category.group.name,
      regulated: category.regulated ?? false,
      relatedCategoryPath: category.relatedCategoryPath ?? null,
      sortOrder,
      isActive: true,
    };
    await prisma.serviceCategory.upsert({ where: { slug: category.slug }, update: data, create: { slug: category.slug, ...data } });
  }
  await prisma.serviceCategory.updateMany({ where: { slug: { notIn: SERVICE_CATEGORIES.map((c) => c.slug) } }, data: { isActive: false } });
  console.log(`Dienstleistungs-Kategorien: ${SERVICE_CATEGORIES.length}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ist nicht gesetzt.');
  const prisma = createPrismaClient(url);
  try {
    await seedGeo(prisma);
    let total = 0;
    const seeded = new Set<string>();
    for (const [vertical, nodes] of Object.entries(CATEGORY_TREE) as [Vertical, CategorySeed[]][]) {
      total += await seedCategoryLevel(prisma, vertical, nodes, null, seeded);
    }
    console.log(`Kategorien: ${total}`);
    await retireOldCategories(prisma, seeded);
    await seedDealCategories(prisma);
    await seedServiceCategories(prisma);
    if (process.argv.includes('--demo')) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Demo-Daten dürfen nicht in Produktion angelegt werden.');
      }
      await seedDemoData(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
