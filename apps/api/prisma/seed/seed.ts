/**
 * Stammdaten-Seed: Bundesländer, Bezirke, vollständiges Ortsverzeichnis (GeoNames) und Kategorien.
 * Idempotent – kann beliebig oft ausgeführt werden.
 *
 *   pnpm db:seed           Stammdaten
 *   pnpm db:seed -- --demo zusätzlich klar gekennzeichnete Demo-Inserate (nur Entwicklung)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATES, slugify, VERTICAL_SLUGS, type Vertical } from '@marktat/shared';
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
    };
    const category = await prisma.category.upsert({
      where: { path },
      update: data,
      create: { path, ...data },
    });
    count += 1;
    if (node.children) {
      count += await seedCategoryLevel(prisma, vertical, node.children, { id: category.id, path });
    }
  }
  return count;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ist nicht gesetzt.');
  const prisma = createPrismaClient(url);
  try {
    await seedGeo(prisma);
    let total = 0;
    for (const [vertical, nodes] of Object.entries(CATEGORY_TREE) as [Vertical, CategorySeed[]][]) {
      total += await seedCategoryLevel(prisma, vertical, nodes, null);
    }
    console.log(`Kategorien: ${total}`);
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
