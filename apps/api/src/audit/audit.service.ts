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
  | 'retention.cleanup'
  // Phase 7: Monetarisierung, Händlerprofil
  | 'billing.booking_created'
  | 'billing.booking_activated'
  | 'billing.booking_cancelled'
  | 'billing.booking_refunded'
  | 'billing.payment_succeeded'
  | 'billing.payment_failed'
  | 'billing.webhook_rejected'
  | 'billing.promotions_expired'
  | 'admin.product_updated'
  | 'admin.billing_settings_updated'
  | 'admin.billing_mode_changed'
  | 'user.logo_updated'
  // Phase 8: Zwei-Faktor-Anmeldung
  | 'security.mfa_enrolled'
  | 'security.mfa_removed'
  | 'admin.mfa_reset'
  // Phase 10: Deals, Filialen, Importe
  | 'dealer.certified'
  | 'dealer.store_created'
  | 'dealer.store_updated'
  | 'dealer.store_deleted'
  | 'deal.created'
  | 'deal.published'
  | 'deal.updated'
  | 'deal.paused'
  | 'deal.resumed'
  | 'deal.verified'
  | 'deal.extended'
  | 'deal.deleted'
  | 'deal.resubmitted'
  | 'deal.image_updated'
  | 'deal.reported'
  | 'deal.expired'
  | 'deal.link_broken'
  | 'moderation.deal_rejected'
  | 'moderation.deal_hidden'
  | 'moderation.deal_restored'
  | 'admin.deal_merchant_changed'
  | 'admin.deals_blocked'
  | 'admin.deals_unblocked'
  | 'deal.import_uploaded'
  | 'deal.import_committed'
  | 'deal.feed_created'
  | 'deal.feed_updated'
  | 'deal.feed_paused'
  | 'deal.feed_resumed'
  | 'deal.feed_deleted'
  | 'deal.feed_previewed'
  | 'deal.feed_failing'
  | 'deal.feed_ended'
  | 'admin.deal_feed_approve'
  | 'admin.deal_feed_reject'
  | 'admin.deal_feed_pause';

/** Ereignisse, die das Dashboard als „wichtig“ hervorhebt */
export const IMPORTANT_AUDIT_PREFIXES = [
  'moderation.',
  'appeal.',
  'admin.',
  'privacy.deletion',
  'report.messages_viewed',
  'billing.payment',
  'billing.booking_refunded',
  'billing.webhook_rejected',
  'security.',
];

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
