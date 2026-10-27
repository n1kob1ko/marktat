/**
 * Baut den Meilisearch-Index vollständig neu auf (ohne Ausfall: neuer Index, danach Tausch).
 *
 *   pnpm --filter @marktat/api search:reindex
 *
 * Sinnvoll nach einer Datenmigration, nach Änderungen an den Suchfeldern oder wenn Meilisearch
 * längere Zeit nicht erreichbar war. Im Normalbetrieb hält die API den Index selbst aktuell.
 * Die Dienste werden direkt erzeugt (tsx kennt keine Decorator-Metadaten für Nests Dependency Injection).
 */
import { CategoriesService } from '../src/categories/categories.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SearchIndexService } from '../src/search/search-index.service.js';

const prisma = new PrismaService();
try {
  const index = new SearchIndexService(prisma, new CategoriesService(prisma));
  if (!index.enabled) throw new Error('MEILI_URL ist nicht gesetzt.');
  if (!(await index.client!.isHealthy())) throw new Error('Meilisearch ist nicht erreichbar (läuft `pnpm infra:up`?).');
  const { indexed, durationMs } = await index.reindexAll();
  console.log(`Suchindex „${index.indexUid}“ neu aufgebaut: ${indexed} Inserate in ${(durationMs / 1000).toFixed(1)} s`);
} finally {
  await prisma.$disconnect();
}
