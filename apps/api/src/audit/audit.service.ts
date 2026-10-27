import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { truncateIp } from '../common/ip.js';

export type AuditAction =
  | 'user.created'
  | 'user.profile_updated'
  | 'listing.created'
  | 'listing.published'
  | 'listing.paused'
  | 'listing.resumed'
  | 'listing.renewed'
  | 'listing.deleted'
  | 'listing.image_added'
  | 'listing.image_rejected'
  | 'listing.image_deleted'
  | 'listing.images_reordered';

export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  /** Keine Passwörter, Tokens oder Freitexte hineinschreiben. */
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Schreibt asynchron; ein Fehler beim Protokollieren bricht die eigentliche Aktion nicht ab. */
  log(event: AuditEvent): void {
    this.prisma.auditLog
      .create({
        data: {
          action: event.action,
          actorId: event.actorId ?? null,
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          ipPrefix: truncateIp(event.ip),
          metadata: event.metadata,
        },
      })
      .catch((error: unknown) => {
        this.logger.error(`Audit-Log fehlgeschlagen (${event.action})`, error instanceof Error ? error.stack : undefined);
      });
  }
}
