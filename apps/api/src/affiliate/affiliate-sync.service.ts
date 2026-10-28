import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AFFILIATE_DEFAULT_VALIDITY_DAYS,
  AFFILIATE_FEED_LIST_INTERVAL_MINUTES,
  AFFILIATE_FEED_MAX_FAILURES,
  AFFILIATE_FEED_MIN_INTERVAL_HOURS,
  AFFILIATE_PROMOTIONS_INTERVAL_HOURS,
  AFFILIATE_URL_MAX_LENGTH,
  DEAL_MAX_DURATION_DAYS,
  dealDiscountPercent,
  isSafeExternalUrl,
  slugify,
  type AffiliateSkipReason,
  type AffiliateSyncStats,
} from '@marktat/shared';
import type { AffiliateFeed, AffiliateProgram, AffiliateSyncKind, Deal, Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { redact } from '../common/redact.js';
import { loadEnv } from '../config/env.js';
import { DISCOUNT_REVIEW_REASON, needsDiscountReview, statusAfterChange } from '../deals/deal-fields.js';
import { DealSearchService } from '../deals/deal-search.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ErrorReporter } from '../monitoring/error-reporter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AwinClient, AwinError, type AwinFeedListEntry } from './awin.client.js';
import { mapAwinRow, matchDealCategory, productHash, type AwinProduct } from './awin-mapping.js';

export const AFFILIATE_SYNC_JOB = 'affiliate-sync';
export const AFFILIATE_PROMOTIONS_JOB = 'affiliate-promotions';
export const AFFILIATE_MANUAL_JOB = 'affiliate-manual';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** Höchstens so viele Feeds je stündlichem Durchlauf (nacheinander, keine Lastspitzen) */
const FEEDS_PER_RUN = 3;
const BATCH = 200;
const PROMOTION_PAGES = 10;
/** Ein Lauf gilt nach dieser Zeit als abgebrochen (z. B. Neustart während des Abrufs) */
const STALE_RUN_MS = 60 * 60_000;
const MANUAL_WAIT_MS = 15 * 60_000;
const ACTIVE_STATES = ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'] as const;

type ProgramRow = AffiliateProgram;
type FeedWithProgram = AffiliateFeed & { program: ProgramRow };

/**
 * Zentrale Affiliate-Deals: holt Programme und Feeds (stündlich, Download nur bei geändertem Stand) sowie
 * Aktionen und Gutscheine (alle 4 Stunden) über die vorhandene Warteschlange (BullMQ). Übernommen wird nur, was das
 * Team freigegeben hat (Programm freigegeben, Partnerschaft aktiv, Feed aktiv). Regeln: docs/affiliate.md
 */
@Injectable()
export class AffiliateSyncService implements OnModuleInit {
  private readonly logger = new Logger(AffiliateSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly awin: AwinClient,
    private readonly jobs: JobsService,
    private readonly search: DealSearchService,
    private readonly audit: AuditService,
    private readonly reporter: ErrorReporter,
  ) {}

  onModuleInit() {
    this.jobs.register(AFFILIATE_SYNC_JOB, () => this.runScheduled().then(() => undefined));
    this.jobs.register(AFFILIATE_PROMOTIONS_JOB, () => this.syncPromotions().then(() => undefined));
    this.jobs.register(AFFILIATE_MANUAL_JOB, (data) => this.runManual(data).then(() => undefined));
    if (this.scheduled()) {
      this.jobs.every(AFFILIATE_SYNC_JOB, AFFILIATE_FEED_LIST_INTERVAL_MINUTES * 60_000);
      this.jobs.every(AFFILIATE_PROMOTIONS_JOB, AFFILIATE_PROMOTIONS_INTERVAL_HOURS * HOUR_MS);
    }
    // Abrufe laufen nur im Worker-Prozess (einer je Server): was beim Start noch als „läuft“ gilt, wurde durch einen
    // Neustart abgebrochen und würde sonst bis zu einer Stunde weitere Abrufe blockieren
    const env = loadEnv();
    if (env.JOBS_WORKER && env.NODE_ENV !== 'test') {
      void this.prisma.affiliateSyncRun
        .updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', finishedAt: new Date(), error: 'Abgebrochen durch einen Neustart während des Abrufs.' } })
        .catch((error: Error) => this.logger.warn(`Offene Abrufe nicht bereinigt: ${error.message}`));
    }
  }

  /** Läuft der automatische Abruf? (eingeschaltet und vollständig konfiguriert) */
  scheduled() {
    return this.awin.enabled && this.awin.missingConfig().length === 0;
  }

  /** Zeitplan: zufällige Verzögerung (Awin bittet, nicht alle zur vollen Stunde abzurufen) */
  private async runScheduled() {
    if (!this.scheduled()) return;
    if (loadEnv().NODE_ENV !== 'test') await new Promise((resolve) => setTimeout(resolve, 10_000 + Math.random() * 110_000));
    await this.syncAll();
  }

  /** Manueller Abruf aus der Admin-Übersicht (nur Administration) */
  async runManual(data: Record<string, unknown>) {
    const actorId = typeof data.actorId === 'string' ? data.actorId : null;
    const kind = data.kind === 'PROMOTIONS' || data.kind === 'FEED_LIST' ? data.kind : 'ALL';
    const feedId = typeof data.feedId === 'string' ? data.feedId : undefined;
    // Läuft gerade ein geplanter Abruf, danach starten statt den manuellen Abruf stillschweigend auszulassen
    for (let waited = 0; this.running && waited < MANUAL_WAIT_MS; waited += 1000) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (kind === 'PROMOTIONS') return this.syncPromotions(actorId);
    if (kind === 'FEED_LIST') return this.syncFeedList(actorId);
    await this.syncAll({ actorId, forceFeedId: feedId });
    await this.syncPromotions(actorId);
  }

  /** Feedliste abgleichen, danach fällige Feeds übernehmen */
  async syncAll(options: { actorId?: string | null; forceFeedId?: string } = {}): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const list = await this.syncFeedList(options.actorId ?? null);
      if (!list) return;
      const due = await this.dueFeeds(options.forceFeedId);
      for (const feed of due) {
        const entry = list.get(feed.id);
        if (entry) await this.syncFeed(feed, entry, options.actorId ?? null);
      }
    } finally {
      this.running = false;
    }
  }

  // --- Feedliste ---------------------------------------------------------------------------

  /** Programme und Feeds laut Awin aktualisieren; liefert Feed-ID → Eintrag (mit Download-Adresse, nur im Speicher) */
  async syncFeedList(actorId: string | null = null): Promise<Map<string, AwinFeedListEntry> | null> {
    if (await this.isRunning('FEED_LIST')) return null;
    const run = await this.startRun('FEED_LIST', { actorId });
    const now = new Date();
    try {
      const entries = await this.awin.feedList();
      const byFeed = new Map<string, AwinFeedListEntry>();
      const programIds = new Map<string, string>();
      const membershipLost: string[] = [];
      for (const entry of entries) {
        let programId = programIds.get(entry.advertiserId);
        if (!programId) {
          const before = await this.prisma.affiliateProgram.findUnique({ where: { network_externalId: { network: 'AWIN', externalId: entry.advertiserId } } });
          const program = await this.prisma.affiliateProgram.upsert({
            where: { network_externalId: { network: 'AWIN', externalId: entry.advertiserId } },
            create: { network: 'AWIN', externalId: entry.advertiserId, name: entry.advertiserName, region: entry.region, membership: entry.membership, membershipCheckedAt: now },
            update: { name: entry.advertiserName, region: entry.region, membership: entry.membership, membershipCheckedAt: now },
          });
          if (before && before.membership === 'JOINED' && entry.membership !== 'JOINED') membershipLost.push(program.id);
          programId = program.id;
          programIds.set(entry.advertiserId, programId);
        }
        const feed = await this.prisma.affiliateFeed.upsert({
          where: { programId_externalId: { programId, externalId: entry.feedId } },
          create: { programId, externalId: entry.feedId, name: entry.feedName, language: entry.language, vertical: entry.vertical, networkUpdatedAt: entry.lastImported, listedAt: now },
          update: { name: entry.feedName, language: entry.language, vertical: entry.vertical, networkUpdatedAt: entry.lastImported, listedAt: now },
        });
        // Wieder in der Liste: muss erneut aktiviert werden
        if (feed.status === 'REMOVED') await this.prisma.affiliateFeed.update({ where: { id: feed.id }, data: { status: 'PAUSED' } });
        byFeed.set(feed.id, entry);
      }
      // Nicht mehr gelistete Feeds: Angebote beenden (Partnerschaft beendet oder Feed entfernt)
      const removed = await this.prisma.affiliateFeed.findMany({ where: { program: { network: 'AWIN' }, status: { not: 'REMOVED' }, OR: [{ listedAt: null }, { listedAt: { lt: now } }] }, select: { id: true } });
      for (const feed of removed) {
        await this.prisma.affiliateFeed.update({ where: { id: feed.id }, data: { status: 'REMOVED', nextFetchAt: null } });
        await this.endFeedDeals(feed.id, null, now);
      }
      for (const programId of membershipLost) {
        this.audit.log({ action: 'affiliate.membership_lost', actorId: null, entityType: 'affiliate_program', entityId: programId });
        await this.resyncProgram(programId);
      }
      await this.finishRun(run.id, 'SUCCESS', { programs: programIds.size, feeds: byFeed.size, ended: removed.length });
      return byFeed;
    } catch (error) {
      await this.failRun(run.id, error);
      return null;
    }
  }

  /** Aktive Feeds freigegebener Programme mit neuem Stand (bzw. ein bestimmter Feed bei manuellem Abruf) */
  private async dueFeeds(forceFeedId?: string): Promise<FeedWithProgram[]> {
    const feeds = await this.prisma.affiliateFeed.findMany({
      where: { status: 'ACTIVE', program: { status: 'APPROVED', membership: 'JOINED' }, ...(forceFeedId && { id: forceFeedId }) },
      include: { program: true },
      orderBy: [{ lastFetchedAt: { sort: 'asc', nulls: 'first' } }],
    });
    const now = Date.now();
    return feeds
      .filter((feed) => {
        if (forceFeedId) return true;
        if (feed.nextFetchAt && feed.nextFetchAt.getTime() > now) return false;
        if (feed.lastFetchedAt && feed.lastFetchedAt.getTime() > now - AFFILIATE_FEED_MIN_INTERVAL_HOURS * HOUR_MS) return false;
        // Nur bei geändertem Stand laut Netzwerk (ohne Angabe: höchstens alle 24 Stunden)
        if (!feed.networkUpdatedAt) return !feed.lastFetchedAt || feed.lastFetchedAt.getTime() < now - DAY_MS;
        return !feed.processedUpdatedAt || feed.networkUpdatedAt > feed.processedUpdatedAt;
      })
      .slice(0, forceFeedId ? 1 : FEEDS_PER_RUN);
  }

  // --- Produktfeed -------------------------------------------------------------------------

  async syncFeed(feed: FeedWithProgram, entry: AwinFeedListEntry, actorId: string | null = null): Promise<AffiliateSyncStats | null> {
    const run = await this.startRun('FEED', { actorId, programId: feed.programId, feedId: feed.id });
    const startedAt = new Date();
    // Datenstand des Händlers: „zuletzt geprüft“ ist der Zeitpunkt, zu dem Awin die Daten zuletzt importiert hat
    const dataTime = entry.lastImported && entry.lastImported < startedAt ? entry.lastImported : startedAt;
    const stats: AffiliateSyncStats = { rows: 0, created: 0, updated: 0, unchanged: 0, ended: 0, withoutImage: 0, review: 0, defaultCategory: 0, skipped: {} };
    const max = loadEnv().AWIN_MAX_PRODUCTS_PER_FEED;
    let close: (() => void) | null = null;
    try {
      const context = await this.context(feed.program);
      const opened = await this.awin.openFeed(entry.url);
      close = opened.close;
      const seen = new Set<string>();
      let batch: AwinProduct[] = [];
      for await (const row of opened.rows) {
        stats.rows!++;
        const mapped = mapAwinRow(row, startedAt, { allowPrivateImages: loadEnv().OUTBOUND_ALLOW_PRIVATE });
        if (!mapped.ok) {
          this.skip(stats, mapped.reason);
          continue;
        }
        if (seen.has(mapped.product.externalId)) continue;
        if (seen.size >= max) {
          this.skip(stats, 'limit');
          stats.truncated = true;
          break;
        }
        seen.add(mapped.product.externalId);
        batch.push(mapped.product);
        if (batch.length >= BATCH) {
          await this.applyBatch(feed, batch, context, run.id, dataTime, stats);
          batch = [];
        }
      }
      if (batch.length) await this.applyBatch(feed, batch, context, run.id, dataTime, stats);
      close();
      // Nur bei vollständig gelesenem Feed: Fehlendes ist nicht mehr im Angebot
      if (!stats.truncated) stats.ended = await this.endFeedDeals(feed.id, run.id, startedAt);
      const productCount = await this.prisma.deal.count({ where: { affiliateFeedId: feed.id, status: { in: [...ACTIVE_STATES] } } });
      await this.prisma.affiliateFeed.update({
        where: { id: feed.id },
        data: {
          processedUpdatedAt: entry.lastImported,
          lastFetchedAt: startedAt,
          nextFetchAt: new Date(startedAt.getTime() + AFFILIATE_FEED_MIN_INTERVAL_HOURS * HOUR_MS),
          consecutiveFailures: 0,
          lastError: null,
          productCount,
        },
      });
      await this.prisma.affiliateProgram.update({ where: { id: feed.programId }, data: { lastSyncAt: startedAt, lastError: null } });
      const skipped = Object.values(stats.skipped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
      await this.finishRun(run.id, skipped || stats.truncated ? 'PARTIAL' : 'SUCCESS', stats);
      return stats;
    } catch (error) {
      close?.();
      const message = this.message(error);
      const failures = feed.consecutiveFailures + 1;
      const failing = failures >= AFFILIATE_FEED_MAX_FAILURES;
      await this.prisma.affiliateFeed.update({
        where: { id: feed.id },
        data: {
          lastFetchedAt: startedAt,
          lastError: message.slice(0, 500),
          consecutiveFailures: failures,
          // Wartezeit wächst mit jedem Fehlschlag (1, 2, 4, 8 Stunden)
          nextFetchAt: failing ? null : new Date(startedAt.getTime() + 2 ** (failures - 1) * HOUR_MS),
          ...(failing && { status: 'FAILING' }),
        },
      });
      await this.prisma.affiliateProgram.update({ where: { id: feed.programId }, data: { lastError: message.slice(0, 500) } });
      if (failing) {
        this.audit.log({ action: 'affiliate.feed_failing', actorId: null, entityType: 'affiliate_feed', entityId: feed.id, metadata: { failures, error: message } });
        this.reporter.capture(new Error(`Awin-Feed ${feed.externalId} angehalten nach ${failures} Fehlschlägen: ${message}`), { source: 'job', route: AFFILIATE_SYNC_JOB });
      }
      await this.failRun(run.id, error, stats);
      return null;
    }
  }

  private skip(stats: AffiliateSyncStats, reason: AffiliateSkipReason) {
    stats.skipped![reason] = (stats.skipped![reason] ?? 0) + 1;
  }

  private async context(program: ProgramRow) {
    const categories = await this.prisma.dealCategory.findMany({ where: { isActive: true }, select: { id: true, slug: true } });
    const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
    const fallback = program.defaultCategoryId ?? bySlug.get('sonstige-angebote') ?? categories[0]?.id;
    if (!fallback) throw new AwinError('Es gibt keine Deal-Kategorien (pnpm db:seed ausführen).', false);
    return { program, bySlug, fallback };
  }

  private async applyBatch(
    feed: FeedWithProgram,
    products: AwinProduct[],
    context: Awaited<ReturnType<AffiliateSyncService['context']>>,
    runId: string,
    dataTime: Date,
    stats: AffiliateSyncStats,
  ) {
    const { program } = context;
    const existing = await this.prisma.deal.findMany({ where: { affiliateProgramId: program.id, externalId: { in: products.map((p) => p.externalId) } } });
    const byExternal = new Map(existing.map((d) => [d.externalId!, d]));
    const changed: string[] = [];
    const seenOnly: string[] = [];
    for (const product of products) {
      const slug = matchDealCategory(product);
      const categoryId = (slug && context.bySlug.get(slug)) || context.fallback;
      if (!slug) stats.defaultCategory!++;
      if (!product.imageUrl || !program.allowImages) stats.withoutImage!++;
      const reference = program.allowReferencePrices && product.rrpCents && product.rrpCents > product.priceCents ? product.rrpCents : null;
      const discountPercent = dealDiscountPercent(product.priceCents, reference, reference ? 'RRP' : null);
      const startsAt = product.validFrom && product.validFrom > dataTime ? product.validFrom : dataTime;
      const maxEnd = new Date(startsAt.getTime() + DEAL_MAX_DURATION_DAYS * DAY_MS);
      const rolling = new Date(dataTime.getTime() + AFFILIATE_DEFAULT_VALIDITY_DAYS * DAY_MS);
      const endsAt = product.validTo ? (product.validTo < maxEnd ? product.validTo : maxEnd) : rolling;
      const hash = createHash('sha256').update(productHash(product, `${categoryId}|${reference ?? ''}|${program.name}`)).digest('hex');
      const fields = {
        affiliateFeedId: feed.id,
        categoryId,
        title: product.title,
        slug: slugify(product.title),
        description: product.description,
        brand: product.brand,
        gtin: product.gtin,
        url: product.url,
        externalImageUrl: product.imageUrl,
        priceCents: product.priceCents,
        shippingNote: product.shippingNote,
        referencePriceCents: reference,
        referencePriceType: reference ? ('RRP' as const) : null,
        referencePriceSource: reference ? `UVP laut Produktfeed von ${program.name} (Awin)` : null,
        discountPercent,
        availability: product.availability,
        startsAt,
        endsAt,
        lastVerifiedAt: dataTime,
        contentHash: hash,
        lastImportId: runId,
      } satisfies Prisma.DealUncheckedUpdateInput;
      const current = byExternal.get(product.externalId);
      if (!current) {
        // Nicht lieferbare Produkte gar nicht erst anlegen
        if (product.availability === 'SOLD_OUT') {
          this.skip(stats, 'outOfStock');
          continue;
        }
        const review = needsDiscountReview(discountPercent);
        const created = await this.prisma.deal.create({
          data: {
            ...fields,
            source: 'AFFILIATE',
            merchantId: null,
            affiliateProgramId: program.id,
            externalId: product.externalId,
            channel: 'ONLINE',
            isAffiliateLink: true,
            status: review ? 'PENDING_REVIEW' : 'ACTIVE',
            reviewReason: review ? DISCOUNT_REVIEW_REASON : null,
            publishedAt: new Date(),
          },
        });
        await this.prisma.dealPriceRecord.create({ data: { dealId: created.id, priceCents: created.priceCents, referencePriceCents: created.referencePriceCents, source: 'AFFILIATE' } });
        stats.created!++;
        if (review) stats.review!++;
        changed.push(created.id);
        continue;
      }
      // Vom Team gelöscht oder abgelehnt: bleibt so, auch wenn der Feed das Produkt weiter enthält
      if (current.status === 'DELETED' || current.status === 'REJECTED') {
        seenOnly.push(current.id);
        stats.unchanged!++;
        continue;
      }
      const reactivate = current.status === 'EXPIRED' || current.status === 'DRAFT';
      if (current.contentHash === hash && current.affiliateFeedId === feed.id && !reactivate) {
        seenOnly.push(current.id);
        stats.unchanged!++;
        continue;
      }
      const priceChanged = current.priceCents !== product.priceCents || current.referencePriceCents !== reference;
      const base: Pick<Deal, 'status' | 'reviewReason'> = reactivate ? { status: 'ACTIVE', reviewReason: null } : current;
      let next = statusAfterChange(base, discountPercent, priceChanged || reactivate);
      if (reactivate && needsDiscountReview(discountPercent)) next = { status: 'PENDING_REVIEW', reviewReason: DISCOUNT_REVIEW_REASON };
      await this.prisma.deal.update({
        where: { id: current.id },
        data: { ...fields, status: next.status, reviewReason: next.reviewReason, ...(reactivate && !current.publishedAt && { publishedAt: new Date() }) },
      });
      if (priceChanged) await this.prisma.dealPriceRecord.create({ data: { dealId: current.id, priceCents: product.priceCents, referencePriceCents: reference, source: 'AFFILIATE' } });
      if (next.status === 'PENDING_REVIEW' && current.status !== 'PENDING_REVIEW') stats.review!++;
      stats.updated!++;
      changed.push(current.id);
    }
    if (seenOnly.length) {
      // Unverändert, aber im aktuellen Feed enthalten: Datenstand übernehmen (zählt als Bestätigung)
      await this.prisma.deal.updateMany({ where: { id: { in: seenOnly } }, data: { lastImportId: runId, lastVerifiedAt: dataTime } });
      changed.push(...seenOnly);
    }
    this.search.index.syncMany(changed);
  }

  /** Laufende Angebote eines Feeds beenden, die im Lauf `runId` nicht vorkamen (runId null = alle) */
  private async endFeedDeals(feedId: string, runId: string | null, now: Date): Promise<number> {
    const missing = await this.prisma.deal.findMany({
      where: { affiliateFeedId: feedId, status: { in: [...ACTIVE_STATES] }, ...(runId && { OR: [{ lastImportId: null }, { lastImportId: { not: runId } }] }) },
      select: { id: true, status: true },
    });
    if (!missing.length) return 0;
    const inReview = missing.filter((d) => d.status === 'PENDING_REVIEW').map((d) => d.id);
    await this.prisma.$transaction([
      this.prisma.deal.updateMany({ where: { id: { in: missing.filter((d) => d.status !== 'PENDING_REVIEW').map((d) => d.id) } }, data: { status: 'EXPIRED', endsAt: now } }),
      // In Prüfung bleibt in Prüfung (wie bei Händlerfeeds), endet aber zeitlich
      this.prisma.deal.updateMany({ where: { id: { in: inReview } }, data: { endsAt: now } }),
    ]);
    this.search.index.syncMany(missing.map((d) => d.id));
    return missing.length;
  }

  /** Sichtbarkeit aller Angebote eines Programms neu bewerten (Freigabe, Pause, Partnerschaft) */
  async resyncProgram(programId: string) {
    const rows = await this.prisma.deal.findMany({ where: { affiliateProgramId: programId, status: { not: 'DELETED' } }, select: { id: true } });
    this.search.index.syncMany(rows.map((r) => r.id));
  }

  async resyncFeed(feedId: string) {
    const rows = await this.prisma.deal.findMany({ where: { affiliateFeedId: feedId, status: { not: 'DELETED' } }, select: { id: true } });
    this.search.index.syncMany(rows.map((r) => r.id));
  }

  // --- Aktionen und Gutscheine ------------------------------------------------------------------

  async syncPromotions(actorId: string | null = null): Promise<AffiliateSyncStats | null> {
    if (!this.awin.enabled || this.awin.missingConfig().length) return null;
    if (await this.isRunning('PROMOTIONS')) return null;
    const run = await this.startRun('PROMOTIONS', { actorId });
    const startedAt = new Date();
    const stats: AffiliateSyncStats = { promotions: 0, hidden: 0, skipped: {} };
    try {
      const programs = new Map<string, ProgramRow>();
      for (let page = 1; page <= PROMOTION_PAGES; page++) {
        const { items, total } = await this.awin.promotions(page);
        for (const item of items) {
          let program = programs.get(item.advertiserId);
          if (!program) {
            program = await this.prisma.affiliateProgram.upsert({
              where: { network_externalId: { network: 'AWIN', externalId: item.advertiserId } },
              create: { network: 'AWIN', externalId: item.advertiserId, name: item.advertiserName, membership: item.joined ? 'JOINED' : 'NOT_JOINED', membershipCheckedAt: startedAt },
              update: { membership: item.joined ? 'JOINED' : 'NOT_JOINED', membershipCheckedAt: startedAt },
            });
            programs.set(item.advertiserId, program);
          }
          const url = item.urlTracking && isSafeExternalUrl(item.urlTracking, AFFILIATE_URL_MAX_LENGTH) ? item.urlTracking : null;
          if (!url) {
            this.skip(stats, 'invalidLink');
            continue;
          }
          if (item.endDate && item.endDate <= startedAt) {
            this.skip(stats, 'expired');
            continue;
          }
          const data = {
            type: item.type,
            title: item.title,
            description: item.description,
            terms: item.terms,
            // Gutscheincodes nur, wenn das Programm sie ausdrücklich erlaubt
            voucherCode: program.allowVouchers ? item.voucherCode : null,
            url,
            startsAt: item.startDate,
            endsAt: item.endDate,
            lastSeenAt: startedAt,
            hiddenAt: null,
          };
          await this.prisma.affiliatePromotion.upsert({
            where: { programId_externalId: { programId: program.id, externalId: item.promotionId } },
            create: { programId: program.id, externalId: item.promotionId, ...data },
            update: data,
          });
          stats.promotions!++;
        }
        if (page * 200 >= total || !items.length) break;
      }
      const hidden = await this.prisma.affiliatePromotion.updateMany({ where: { hiddenAt: null, lastSeenAt: { lt: startedAt }, program: { network: 'AWIN' } }, data: { hiddenAt: startedAt } });
      stats.hidden = hidden.count;
      const skipped = Object.values(stats.skipped ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
      await this.finishRun(run.id, skipped ? 'PARTIAL' : 'SUCCESS', stats);
      return stats;
    } catch (error) {
      await this.failRun(run.id, error, stats);
      return null;
    }
  }

  // --- Protokoll -------------------------------------------------------------------------------

  private async isRunning(kind: AffiliateSyncKind) {
    const since = new Date(Date.now() - STALE_RUN_MS);
    // Abgebrochene Läufe (Neustart) nicht ewig als „läuft“ zählen
    await this.prisma.affiliateSyncRun.updateMany({ where: { kind, status: 'RUNNING', startedAt: { lt: since } }, data: { status: 'FAILED', finishedAt: new Date(), error: 'Abgebrochen (z. B. Neustart während des Abrufs).' } });
    return (await this.prisma.affiliateSyncRun.count({ where: { kind, status: 'RUNNING' } })) > 0;
  }

  private startRun(kind: AffiliateSyncKind, options: { actorId?: string | null; programId?: string; feedId?: string }) {
    return this.prisma.affiliateSyncRun.create({ data: { network: 'AWIN', kind, programId: options.programId, feedId: options.feedId, triggeredById: options.actorId ?? null } });
  }

  private async finishRun(id: string, status: 'SUCCESS' | 'PARTIAL', stats: AffiliateSyncStats) {
    await this.prisma.affiliateSyncRun.update({ where: { id }, data: { status, stats: stats as Prisma.InputJsonValue, finishedAt: new Date() } });
  }

  private async failRun(id: string, error: unknown, stats: AffiliateSyncStats = {}) {
    const message = this.message(error);
    this.logger.warn(`Awin-Abruf fehlgeschlagen: ${message}`);
    if (!(error instanceof AwinError)) this.reporter.capture(error, { source: 'job', route: AFFILIATE_SYNC_JOB });
    await this.prisma.affiliateSyncRun.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 1000), stats: stats as Prisma.InputJsonValue, finishedAt: new Date() } });
  }

  private message(error: unknown) {
    return redact(error instanceof Error ? error.message : String(error)) || 'Unbekannter Fehler';
  }
}
