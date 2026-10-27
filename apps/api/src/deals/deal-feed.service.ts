import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  CsvParseError,
  DEAL_FEED_MAX_BYTES,
  DEAL_FEED_MAX_FAILURES,
  DEAL_FEED_MAX_PER_MERCHANT,
  missingRequiredFields,
  parseCsv,
  parseJsonFeed,
  suggestDealImportMapping,
  type DealFeedInput,
  type DealFeedReviewInput,
  type DealFeedStatus,
  type DealFeedView,
  type DealImportMapping,
  type DealImportView,
  type ParsedTable,
} from '@marktat/shared';
import type { DealFeed, Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { safeFetch, SafeFetchError } from '../common/safe-fetch.js';
import { loadEnv } from '../config/env.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeText, DealImportService } from './deal-import.service.js';
import { DealSearchService } from './deal-search.service.js';

export const DEAL_FEED_SYNC_JOB = 'deal-feed-sync';
export const DEAL_IMPORT_CLEANUP_JOB = 'deal-import-cleanup';
const FEED_SYNC_INTERVAL_MS = 15 * 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;
/** Höchstens so viele Feeds je Durchlauf (nacheinander, damit keine Lastspitzen entstehen) */
const FEEDS_PER_RUN = 5;
const USER_AGENT = 'MarktAT-Feedabruf/1.0 (+https://marktat.at; ruft nur freigegebene Händler-Feeds ab)';

type FeedWithMerchant = DealFeed & { merchant: { id: string; displayName: string; companyName: string | null } };

class FeedError extends Error {}

/**
 * Produktfeeds der Händler. Ablauf: Händler hinterlegt Feed (Adresse, Format, Herkunft/Lizenz) → Probeabruf mit
 * Vorschau → Team gibt frei → regelmäßiger Abruf (frühestens alle 6 Stunden, bedingte Anfragen mit ETag) →
 * Aktualisierung über dieselbe Prüfung wie der CSV-Import. Angebote, die nicht mehr im Feed stehen, werden beendet.
 * Nach mehreren Fehlschlägen in Folge wird der Feed angehalten; seine Angebote verlieren dann nach 14 Tagen
 * ohne Bestätigung automatisch die Sichtbarkeit.
 */
@Injectable()
export class DealFeedService implements OnModuleInit {
  private readonly logger = new Logger(DealFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly imports: DealImportService,
    private readonly search: DealSearchService,
  ) {}

  onModuleInit() {
    this.jobs.register(DEAL_IMPORT_CLEANUP_JOB, () => this.imports.expirePreviews().then(() => undefined));
    this.jobs.every(DEAL_IMPORT_CLEANUP_JOB, CLEANUP_INTERVAL_MS);
    if (loadEnv().DEAL_FEED_SYNC) {
      this.jobs.register(DEAL_FEED_SYNC_JOB, () => this.runDue().then(() => undefined));
      this.jobs.every(DEAL_FEED_SYNC_JOB, FEED_SYNC_INTERVAL_MS);
    }
  }

  // --- Händler -------------------------------------------------------------------------

  async list(user: AuthUser): Promise<DealFeedView[]> {
    const rows = await this.prisma.dealFeed.findMany({ where: { merchantId: user.id, deletedAt: null }, include: this.include(), orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async create(user: AuthUser, input: DealFeedInput, ip?: string): Promise<DealFeedView> {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Produktfeeds gibt es nur für gewerbliche Konten.');
    const count = await this.prisma.dealFeed.count({ where: { merchantId: user.id, deletedAt: null } });
    if (count >= DEAL_FEED_MAX_PER_MERCHANT) throw new ConflictException(`Höchstens ${DEAL_FEED_MAX_PER_MERCHANT} Feeds je Händler.`);
    const feed = await this.prisma.dealFeed.create({
      data: {
        merchantId: user.id,
        name: input.name,
        url: input.url,
        format: input.format,
        intervalHours: input.intervalHours,
        licenseNote: input.licenseNote,
        licenseConfirmedAt: new Date(),
        referencePricesConfirmed: input.referencePricesConfirmed,
        imageRights: input.imageRights ?? null,
      },
      include: this.include(),
    });
    this.audit.log({ action: 'deal.feed_created', actorId: user.id, entityType: 'deal_feed', entityId: feed.id, ip, metadata: { host: new URL(input.url).host } });
    return this.toView(feed);
  }

  /** Bearbeiten; eine neue Adresse oder ein anderes Format braucht eine neue Freigabe */
  async update(user: AuthUser, id: string, input: DealFeedInput, ip?: string): Promise<DealFeedView> {
    const current = await this.requireOwned(user, id);
    const needsReview = current.url !== input.url || current.format !== input.format;
    const feed = await this.prisma.dealFeed.update({
      where: { id },
      data: {
        name: input.name,
        url: input.url,
        format: input.format,
        intervalHours: input.intervalHours,
        licenseNote: input.licenseNote,
        licenseConfirmedAt: new Date(),
        referencePricesConfirmed: input.referencePricesConfirmed,
        imageRights: input.imageRights ?? null,
        ...(needsReview && { status: 'PENDING', approvedAt: null, nextFetchAt: null, etag: null, lastModified: null }),
      },
      include: this.include(),
    });
    this.audit.log({ action: 'deal.feed_updated', actorId: user.id, entityType: 'deal_feed', entityId: id, ip, metadata: { needsReview } });
    return this.toView(feed);
  }

  async setMapping(user: AuthUser, id: string, mapping: DealImportMapping): Promise<DealFeedView> {
    await this.requireOwned(user, id);
    const feed = await this.prisma.dealFeed.update({ where: { id }, data: { mapping }, include: this.include() });
    return this.toView(feed);
  }

  /** Händler pausiert bzw. setzt fort (fortsetzen nur, wenn das Team den Feed bereits freigegeben hatte) */
  async setPaused(user: AuthUser, id: string, paused: boolean, ip?: string): Promise<DealFeedView> {
    const current = await this.requireOwned(user, id);
    if (paused && !['APPROVED', 'FAILING'].includes(current.status)) throw new ConflictException('Nur freigegebene Feeds können pausiert werden.');
    if (!paused && (current.status !== 'PAUSED' && current.status !== 'FAILING')) throw new ConflictException('Der Feed ist nicht pausiert.');
    if (!paused && !current.approvedAt) throw new ConflictException('Der Feed wartet noch auf die Freigabe.');
    const feed = await this.prisma.dealFeed.update({
      where: { id },
      data: paused ? { status: 'PAUSED', nextFetchAt: null } : { status: 'APPROVED', consecutiveFailures: 0, lastError: null, nextFetchAt: new Date() },
      include: this.include(),
    });
    this.audit.log({ action: paused ? 'deal.feed_paused' : 'deal.feed_resumed', actorId: user.id, entityType: 'deal_feed', entityId: id, ip });
    return this.toView(feed);
  }

  /** Feed entfernen; seine Deals bleiben (ohne weitere Aktualisierung) und verlieren nach 14 Tagen die Sichtbarkeit */
  async remove(user: AuthUser, id: string, ip?: string) {
    await this.requireOwned(user, id);
    await this.prisma.dealFeed.update({ where: { id }, data: { deletedAt: new Date(), status: 'PAUSED', nextFetchAt: null } });
    this.audit.log({ action: 'deal.feed_deleted', actorId: user.id, entityType: 'deal_feed', entityId: id, ip });
  }

  /** Probeabruf: lädt den Feed einmal und zeigt die Vorschau – übernimmt nichts (auch vor der Freigabe möglich) */
  async preview(user: AuthUser, id: string, ip?: string): Promise<DealImportView> {
    const feed = await this.requireOwned(user, id);
    const created = await this.prisma.dealImport.create({ data: { merchantId: user.id, feedId: id, source: 'FEED', format: feed.format, fileName: feed.name } });
    try {
      const download = await this.download(feed, false);
      if (download.notModified) throw new FeedError('Der Feed hat keine Daten geliefert.');
      const { table } = download;
      const mapping = this.mappingFor(feed, table);
      const plan = await this.imports.analyze(user.id, table, mapping);
      const updated = await this.prisma.dealImport.update({
        where: { id: created.id },
        data: {
          status: 'CANCELLED',
          headers: table.headers,
          mapping,
          rows: plan.rows.map(({ fields: _f, existing: _e, ...rest }) => rest) as unknown as Prisma.InputJsonValue,
          counts: plan.counts as unknown as Prisma.InputJsonValue,
          hasReferencePrices: plan.hasReferencePrices,
          error: 'Probeabruf – nichts übernommen.',
        },
      });
      this.audit.log({ action: 'deal.feed_previewed', actorId: user.id, entityType: 'deal_feed', entityId: id, ip });
      return this.imports.toView(updated);
    } catch (error) {
      const message = error instanceof FeedError || error instanceof BadRequestException ? error.message : 'Der Feed konnte nicht abgerufen werden.';
      await this.prisma.dealImport.update({ where: { id: created.id }, data: { status: 'FAILED', error: message.slice(0, 500) } });
      throw new BadRequestException(message);
    }
  }

  // --- Team ------------------------------------------------------------------------------

  async adminList(status?: DealFeedStatus): Promise<DealFeedView[]> {
    const rows = await this.prisma.dealFeed.findMany({
      where: { deletedAt: null, ...(status && { status }) },
      include: this.include(),
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async review(admin: AuthUser, id: string, input: DealFeedReviewInput, ip?: string): Promise<DealFeedView> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Feed gibt es nicht.');
    const current = await this.prisma.dealFeed.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new NotFoundException('Diesen Feed gibt es nicht.');
    if (current.merchantId === admin.id) throw new ForbiddenException('Eigene Feeds gibt jemand anderer aus dem Team frei.');
    const data: Prisma.DealFeedUpdateInput =
      input.decision === 'APPROVE'
        ? { status: 'APPROVED', approvedAt: new Date(), reviewedById: admin.id, reviewNote: input.note ?? null, nextFetchAt: new Date(), consecutiveFailures: 0, lastError: null }
        : input.decision === 'REJECT'
          ? { status: 'REJECTED', approvedAt: null, reviewedById: admin.id, reviewNote: input.note ?? null, nextFetchAt: null }
          : { status: 'PAUSED', reviewedById: admin.id, reviewNote: input.note ?? null, nextFetchAt: null };
    const feed = await this.prisma.dealFeed.update({ where: { id }, data, include: this.include() });
    this.audit.log({ action: `admin.deal_feed_${input.decision.toLowerCase() as 'approve' | 'reject' | 'pause'}`, actorId: admin.id, entityType: 'deal_feed', entityId: id, ip, metadata: { note: input.note ?? null } });
    return this.toView(feed);
  }

  // --- Abruf ------------------------------------------------------------------------------

  async runDue(now = new Date()): Promise<{ processed: number }> {
    const due = await this.prisma.dealFeed.findMany({
      where: { status: 'APPROVED', deletedAt: null, OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }] },
      orderBy: [{ nextFetchAt: { sort: 'asc', nulls: 'first' } }],
      take: FEEDS_PER_RUN,
    });
    for (const feed of due) await this.sync(feed);
    return { processed: due.length };
  }

  /** Einen freigegebenen Feed abrufen und übernehmen; Fehler werden am Feed und als Import festgehalten */
  async sync(feed: DealFeed): Promise<DealImportView> {
    const startedAt = new Date();
    const nextFetchAt = new Date(startedAt.getTime() + feed.intervalHours * 3600_000);
    const record = await this.prisma.dealImport.create({ data: { merchantId: feed.merchantId, feedId: feed.id, source: 'FEED', format: feed.format, fileName: feed.name, status: 'COMMITTED', publish: true } });
    try {
      if (feed.status !== 'APPROVED') throw new FeedError('Der Feed ist nicht freigegeben.');
      const download = await this.download(feed, true);
      if (download.notModified) {
        // Unverändert seit dem letzten Abruf: gilt als Bestätigung der laufenden Angebote
        await this.prisma.deal.updateMany({ where: { feedId: feed.id, status: { in: ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'] }, endsAt: { gt: startedAt } }, data: { lastVerifiedAt: startedAt, lastImportId: record.id } });
        await this.prisma.dealFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: startedAt, nextFetchAt, consecutiveFailures: 0, lastError: null } });
        const updated = await this.prisma.dealImport.update({ where: { id: record.id }, data: { committedAt: new Date(), error: 'Unverändert seit dem letzten Abruf (HTTP 304).' } });
        return this.imports.toView(updated);
      }
      const { table, etag, lastModified } = download;
      const mapping = this.mappingFor(feed, table);
      if (missingRequiredFields(mapping).length) throw new FeedError('Nicht alle Pflichtspalten sind zugeordnet. Bitte prüfe die Zuordnung des Feeds.');
      const plan = await this.imports.analyze(feed.merchantId, table, mapping);
      const result = await this.imports.apply(feed.merchantId, plan, {
        source: 'FEED',
        feedId: feed.id,
        importId: record.id,
        publish: true,
        confirmReferencePrices: feed.referencePricesConfirmed,
        actorId: feed.merchantId,
      });
      const ended = await this.endMissing(feed, plan.rows.map((r) => r.externalId).filter((v): v is string => Boolean(v)), record.id, startedAt);
      const rows = [...result.rows, ...ended];
      const counts = { ...result.counts, ended: ended.length };
      await this.prisma.dealFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: startedAt, nextFetchAt, consecutiveFailures: 0, lastError: null, etag, lastModified } });
      const updated = await this.prisma.dealImport.update({
        where: { id: record.id },
        data: { committedAt: new Date(), headers: table.headers, mapping, rows: rows as unknown as Prisma.InputJsonValue, counts: counts as unknown as Prisma.InputJsonValue, hasReferencePrices: plan.hasReferencePrices },
      });
      return this.imports.toView(updated);
    } catch (error) {
      const message = (error instanceof FeedError || error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof ConflictException
        ? error.message
        : 'Unerwarteter Fehler beim Abruf.'
      ).slice(0, 500);
      if (!(error instanceof FeedError || error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof ConflictException)) {
        this.logger.warn(`Feed ${feed.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const failures = feed.consecutiveFailures + 1;
      const failing = failures >= DEAL_FEED_MAX_FAILURES;
      await this.prisma.dealFeed.update({
        where: { id: feed.id },
        data: { lastFetchedAt: startedAt, lastError: message, consecutiveFailures: failures, nextFetchAt: failing ? null : nextFetchAt, ...(failing && { status: 'FAILING' }) },
      });
      if (failing) this.audit.log({ action: 'deal.feed_failing', actorId: null, entityType: 'deal_feed', entityId: feed.id, metadata: { failures, error: message } });
      const updated = await this.prisma.dealImport.update({ where: { id: record.id }, data: { status: 'FAILED', error: message } });
      return this.imports.toView(updated);
    }
  }

  /** Nicht mehr im Feed enthaltene, laufende Angebote dieses Feeds beenden (keine veralteten Angebote) */
  private async endMissing(feed: DealFeed, externalIds: string[], importId: string, now: Date) {
    const missing = await this.prisma.deal.findMany({
      where: { feedId: feed.id, status: { in: ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DRAFT'] }, endsAt: { gt: now }, externalId: { notIn: externalIds } },
      select: { id: true, title: true, externalId: true },
    });
    if (!missing.length) return [];
    await this.prisma.deal.updateMany({ where: { id: { in: missing.map((d) => d.id) } }, data: { status: 'EXPIRED', endsAt: now, lastImportId: importId } });
    this.audit.log({ action: 'deal.feed_ended', actorId: null, entityType: 'deal_feed', entityId: feed.id, metadata: { deals: missing.length, importId } });
    this.search.index.syncMany(missing.map((d) => d.id));
    return missing.map((d) => ({ line: 0, externalId: d.externalId, title: d.title, action: 'END' as const, dealId: d.id, changes: [], messages: ['Nicht mehr im Feed – Angebot beendet.'], warnings: [] }));
  }

  private async download(feed: DealFeed, conditional: boolean): Promise<{ table: ParsedTable; etag: string | null; lastModified: string | null; notModified?: false } | { notModified: true }> {
    const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: feed.format === 'JSON' ? 'application/json' : 'text/csv,text/plain;q=0.9,*/*;q=0.5' };
    if (conditional && feed.etag) headers['if-none-match'] = feed.etag;
    if (conditional && feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    let response;
    try {
      response = await safeFetch(feed.url, { method: 'GET', maxBytes: DEAL_FEED_MAX_BYTES + 1, timeoutMs: 20_000, maxRedirects: 3, headers, allowPrivate: loadEnv().OUTBOUND_ALLOW_PRIVATE });
    } catch (error) {
      throw new FeedError(error instanceof SafeFetchError ? `Der Feed ist nicht erreichbar: ${error.message}` : 'Der Feed ist nicht erreichbar.');
    }
    if (conditional && response.status === 304) return { notModified: true };
    if (response.status === 429) throw new FeedError('Der Server des Feeds begrenzt die Abrufe (HTTP 429). Wir versuchen es beim nächsten Termin erneut.');
    if (response.status < 200 || response.status >= 300) throw new FeedError(`Der Feed antwortet mit HTTP ${response.status}.`);
    if (response.truncated || response.body.length > DEAL_FEED_MAX_BYTES) throw new FeedError('Der Feed ist größer als 5 MB. Bitte teile ihn auf.');
    const text = decodeText(response.body);
    let table: ParsedTable;
    try {
      table = feed.format === 'JSON' ? parseJsonFeed(text) : parseCsv(text);
    } catch (error) {
      if (error instanceof CsvParseError) throw new FeedError(error.message);
      throw error;
    }
    const header = (name: string) => {
      const value = response.headers[name];
      return (Array.isArray(value) ? value[0] : value)?.slice(0, 200) ?? null;
    };
    return { table, etag: header('etag'), lastModified: header('last-modified') };
  }

  private mappingFor(feed: DealFeed, table: ParsedTable): DealImportMapping {
    const stored = feed.mapping as DealImportMapping;
    return Object.keys(stored).length ? stored : suggestDealImportMapping(table.headers);
  }

  private include() {
    return { merchant: { select: { id: true, displayName: true, companyName: true } } } as const;
  }

  private async requireOwned(user: AuthUser, id: string) {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Feed gibt es nicht.');
    const feed = await this.prisma.dealFeed.findUnique({ where: { id } });
    if (!feed || feed.deletedAt || feed.merchantId !== user.id) throw new NotFoundException('Diesen Feed gibt es nicht.');
    return feed;
  }

  private async toView(feed: FeedWithMerchant): Promise<DealFeedView> {
    const [dealCount, lastImport] = await Promise.all([
      this.prisma.deal.count({ where: { feedId: feed.id, status: { not: 'DELETED' } } }),
      this.prisma.dealImport.findFirst({ where: { feedId: feed.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      id: feed.id,
      merchant: { id: feed.merchant.id, name: feed.merchant.companyName ?? feed.merchant.displayName },
      name: feed.name,
      url: feed.url,
      format: feed.format,
      intervalHours: feed.intervalHours,
      licenseNote: feed.licenseNote,
      referencePricesConfirmed: feed.referencePricesConfirmed,
      status: feed.status,
      mapping: feed.mapping as DealImportMapping,
      reviewNote: feed.reviewNote,
      approvedAt: feed.approvedAt?.toISOString() ?? null,
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
      nextFetchAt: feed.nextFetchAt?.toISOString() ?? null,
      lastError: feed.lastError,
      consecutiveFailures: feed.consecutiveFailures,
      dealCount,
      createdAt: feed.createdAt.toISOString(),
      lastImport: lastImport ? this.imports.toSummary(lastImport) : null,
    };
  }
}
