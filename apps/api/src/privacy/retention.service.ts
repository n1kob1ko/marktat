import { Injectable, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RETENTION_DAYS } from './retention.js';

const RETENTION_JOB = 'retention-cleanup';
const DAY_MS = 86_400_000;

export interface RetentionResult {
  notifications: number;
  auditLogs: number;
  reports: number;
  decisions: number;
  placeholders: number;
  errorEvents: number;
}

/** Löscht täglich Daten, deren Frist abgelaufen ist (siehe retention.ts). */
@Injectable()
export class RetentionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(RETENTION_JOB, () => this.run().then(() => undefined));
    this.jobs.every(RETENTION_JOB, DAY_MS);
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const notifications = await this.prisma.notification.deleteMany({
      where: { OR: [{ readAt: { lt: before(RETENTION_DAYS.readNotifications) } }, { createdAt: { lt: before(RETENTION_DAYS.notifications) } }] },
    });
    const auditLogs = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: before(RETENTION_DAYS.auditLog) } } });
    const reports = await this.prisma.report.deleteMany({
      where: { status: { in: ['RESOLVED', 'DISMISSED'] }, handledAt: { lt: before(RETENTION_DAYS.closedReports) } },
    });
    // Noch wirksame Maßnahmen (aktuelle Sperre, abgelehntes Inserat) bleiben, solange sie gelten.
    const decisions = await this.prisma.moderationDecision.deleteMany({
      where: {
        createdAt: { lt: before(RETENTION_DAYS.decisions) },
        NOT: [
          { appeal: { is: { status: 'OPEN' } } },
          { action: 'ACCOUNT_SUSPENDED', user: { status: 'SUSPENDED' }, reversedBy: { none: {} } },
          { action: { in: ['LISTING_REJECTED', 'LISTING_HIDDEN'] }, listing: { status: { in: ['REJECTED', 'PENDING_REVIEW'] } }, reversedBy: { none: {} } },
        ],
      },
    });
    // Platzhalter gelöschter Konten: danach verschwinden auch die letzten Verweise (Entscheidungen per Cascade)
    const placeholders = await this.prisma.user.deleteMany({
      where: { status: 'DELETED', deletion: { status: 'COMPLETED', completedAt: { lt: before(RETENTION_DAYS.deletedAccountPlaceholder) } } },
    });
    const errorEvents = await this.prisma.errorEvent.deleteMany({ where: { lastSeenAt: { lt: before(RETENTION_DAYS.errorEvents) } } });
    const result = {
      notifications: notifications.count,
      auditLogs: auditLogs.count,
      reports: reports.count,
      decisions: decisions.count,
      placeholders: placeholders.count,
      errorEvents: errorEvents.count,
    };
    if (Object.values(result).some(Boolean)) this.audit.log({ action: 'retention.cleanup', metadata: { ...result } });
    return result;
  }
}
