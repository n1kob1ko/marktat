import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { loadEnv } from '../config/env.js';
import { safeFetch, SafeFetchError } from '../common/safe-fetch.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DealSearchService } from './deal-search.service.js';
import { publicDealWhere } from './deals.mapper.js';

export const DEAL_EXPIRY_JOB = 'deal-expiry';
export const DEAL_LINK_CHECK_JOB = 'deal-link-check';
const EXPIRY_INTERVAL_MS = 10 * 60_000;
const LINK_CHECK_INTERVAL_MS = 30 * 60_000;
/** Jeder Link höchstens einmal am Tag */
const LINK_RECHECK_MS = 24 * 3600_000;
const LINK_BATCH = 40;
/** Erst nach so vielen eindeutigen Fehlern (404/410) in Folge gilt ein Link als defekt */
export const LINK_FAILURES_UNTIL_BROKEN = 3;
const USER_AGENT = 'MarktAT-Linkpruefung/1.0 (+https://marktat.at; prüft nur, ob die Angebotsseite existiert)';

export type LinkCheckResult = 'ok' | 'gone' | 'unknown';

/**
 * Hintergrundaufgaben der Deals:
 * - Ablauf: Deals nach dem Enddatum auf „abgelaufen“ setzen (unsichtbar sind sie ab Ende ohnehin sofort).
 * - Linkprüfung: Existiert die Angebotsseite noch? Nur 404/410 zählen als Fehler, nach mehreren in Folge
 *   wird der Deal ausgeblendet. Gesperrte Prüfungen (403, 429, 5xx, Zeitüberschreitung) ändern nichts.
 * Nicht mehr bestätigte Deals (DEAL_VERIFY_DAYS) blendet bereits die Sichtbarkeitsregel aus.
 */
@Injectable()
export class DealMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(DealMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly search: DealSearchService,
  ) {}

  onModuleInit() {
    this.jobs.register(DEAL_EXPIRY_JOB, () => this.expire().then(() => undefined));
    this.jobs.every(DEAL_EXPIRY_JOB, EXPIRY_INTERVAL_MS);
    if (loadEnv().DEAL_LINK_CHECK) {
      this.jobs.register(DEAL_LINK_CHECK_JOB, () => this.checkLinks().then(() => undefined));
      this.jobs.every(DEAL_LINK_CHECK_JOB, LINK_CHECK_INTERVAL_MS);
    }
  }

  async expire(now = new Date()): Promise<{ expired: number }> {
    const due = await this.prisma.deal.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] }, endsAt: { lte: now } },
      select: { id: true, merchantId: true },
      take: 1000,
    });
    if (!due.length) return { expired: 0 };
    const ids = due.map((d) => d.id);
    const result = await this.prisma.deal.updateMany({ where: { id: { in: ids }, status: { in: ['ACTIVE', 'PAUSED'] }, endsAt: { lte: now } }, data: { status: 'EXPIRED' } });
    for (const deal of due) this.audit.log({ action: 'deal.expired', actorId: null, entityType: 'deal', entityId: deal.id, metadata: { merchantId: deal.merchantId } });
    this.search.index.syncMany(ids);
    return { expired: result.count };
  }

  /** Prüft fällige Links öffentlich sichtbarer Deals, nacheinander (keine Last bei Händlern) */
  async checkLinks(now = new Date()): Promise<{ checked: number; broken: number }> {
    const due = await this.prisma.deal.findMany({
      where: {
        ...publicDealWhere(now),
        // Nicht bei Affiliate-Deals: Abrufe der Tracking-Links zählten beim Netzwerk als Klicks (Klickbetrug)
        source: { not: 'AFFILIATE' },
        url: { not: null },
        OR: [{ linkCheckedAt: null }, { linkCheckedAt: { lt: new Date(now.getTime() - LINK_RECHECK_MS) } }],
      },
      orderBy: [{ linkCheckedAt: { sort: 'asc', nulls: 'first' } }],
      select: { id: true, url: true, linkFailures: true, merchantId: true },
      take: LINK_BATCH,
    });
    let broken = 0;
    for (const deal of due) {
      const result = await checkLink(deal.url!);
      if (result === 'unknown') {
        await this.prisma.$executeRaw`UPDATE deals SET link_checked_at = ${new Date()} WHERE id = ${deal.id}`;
        continue;
      }
      if (result === 'ok') {
        await this.prisma.$executeRaw`UPDATE deals SET link_checked_at = ${new Date()}, link_failures = 0, link_status = 'OK' WHERE id = ${deal.id}`;
        continue;
      }
      const failures = deal.linkFailures + 1;
      if (failures >= LINK_FAILURES_UNTIL_BROKEN) {
        // Ausblenden ändert die Sichtbarkeit: über Prisma (updatedAt) und danach den Suchindex aktualisieren
        await this.prisma.deal.update({ where: { id: deal.id }, data: { linkCheckedAt: new Date(), linkFailures: failures, linkStatus: 'BROKEN' } });
        this.audit.log({ action: 'deal.link_broken', actorId: null, entityType: 'deal', entityId: deal.id, metadata: { merchantId: deal.merchantId, failures } });
        this.search.index.sync(deal.id);
        broken++;
      } else {
        await this.prisma.$executeRaw`UPDATE deals SET link_checked_at = ${new Date()}, link_failures = ${failures} WHERE id = ${deal.id}`;
      }
    }
    if (broken) this.logger.log(`${broken} Deal(s) wegen nicht mehr erreichbarer Angebotsseite ausgeblendet`);
    return { checked: due.length, broken };
  }
}

/** Gibt es die Seite noch? HEAD, bei 405/501 ein kleiner GET. Nur 404 und 410 sind eindeutig. */
export async function checkLink(url: string): Promise<LinkCheckResult> {
  const allowPrivate = loadEnv().OUTBOUND_ALLOW_PRIVATE;
  const headers = { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.5' };
  try {
    let response = await safeFetch(url, { method: 'HEAD', timeoutMs: 8000, maxRedirects: 5, headers, allowPrivate });
    if (response.status === 405 || response.status === 501) {
      response = await safeFetch(url, { method: 'GET', maxBytes: 16 * 1024, timeoutMs: 8000, maxRedirects: 5, headers, allowPrivate });
    }
    if (response.status === 404 || response.status === 410) return 'gone';
    if (response.status >= 200 && response.status < 400) return 'ok';
    return 'unknown';
  } catch (error) {
    // Nicht mehr öffentlich (z. B. Weiterleitung auf eine interne Adresse) gilt als nicht erreichbar, Netzwerkfehler nicht
    if (error instanceof SafeFetchError && !error.transient) return 'gone';
    return 'unknown';
  }
}
