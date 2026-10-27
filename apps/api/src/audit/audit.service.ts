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
  | 'listing.images_reordered'
  | 'conversation.started'
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.reported'
  // Phase 6: Meldungen, Moderation, Rollen, Datenschutz
  | 'listing.reported'
  | 'listing.resubmitted'
  | 'report.updated'
  | 'report.dismissed'
  | 'report.messages_viewed'
  | 'moderation.listing_rejected'
  | 'moderation.listing_hidden'
  | 'moderation.listing_restored'
  | 'moderation.account_suspended'
  | 'moderation.account_restored'
  | 'appeal.created'
  | 'appeal.decided'
  | 'admin.role_changed'
  | 'admin.reporting_restricted'
  | 'admin.deletion_retried'
  | 'privacy.export'
  | 'privacy.reauth_failed'
  | 'privacy.deletion_requested'
  | 'privacy.deletion_completed'
  | 'privacy.deletion_failed'
  | 'retention.cleanup';

/** Ereignisse, die das Dashboard als „wichtig“ hervorhebt */
export const IMPORTANT_AUDIT_PREFIXES = ['moderation.', 'appeal.', 'admin.', 'privacy.deletion', 'report.messages_viewed'];

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
