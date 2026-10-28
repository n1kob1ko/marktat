/**
 * Baut die Meilisearch-Indizes (Inserate und Deals) vollständig neu auf (ohne Ausfall: neuer Index, danach Tausch).
 *
 *   pnpm --filter @marktat/api search:reindex
 *
 * Sinnvoll nach einer Datenmigration, nach Änderungen an den Suchfeldern oder wenn Meilisearch
 * längere Zeit nicht erreichbar war. Im Normalbetrieb hält die API den Index selbst aktuell.
 * Die Dienste werden direkt erzeugt (tsx kennt keine Decorator-Metadaten für Nests Dependency Injection).
 */
import { CategoriesService } from '../src/categories/categories.service.js';
import { loadEnv, signingSecret } from '../src/config/env.js';
import { DealSearchService } from '../src/deals/deal-search.service.js';
import { GeoService } from '../src/geo/geo.service.js';
import { MediaUrls } from '../src/images/media.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SearchIndexService } from '../src/search/search-index.service.js';

const prisma = new PrismaService();
try {
  const index = new SearchIndexService(prisma, new CategoriesService(prisma));
  if (!index.enabled) throw new Error('MEILI_URL ist nicht gesetzt.');
  if (!(await index.client!.isHealthy())) throw new Error('Meilisearch ist nicht erreichbar (läuft `pnpm infra:up`?).');
  const { indexed, durationMs } = await index.reindexAll();
  console.log(`Suchindex „${index.indexUid}“ neu aufgebaut: ${indexed} Inserate in ${(durationMs / 1000).toFixed(1)} s`);
  // Deals (Händler-Deals, Händler-Feeds und Partnerangebote) liegen in einem eigenen Index
  const env = loadEnv();
  const deals = new DealSearchService(prisma, new MediaUrls(env.API_URL, signingSecret(env)), new GeoService(prisma));
  const started = Date.now();
  const result = await deals.index.reindexAll();
  console.log(`Deal-Index neu aufgebaut: ${result.indexed} Angebote in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await prisma.$disconnect();
}
