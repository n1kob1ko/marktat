import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BookingsService } from './bookings.service.js';
import { STRIPE_GATEWAY, type CheckoutSession, type StripeGateway } from './stripe.gateway.js';

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export type WebhookOutcome = { received: true; result: 'processed' | 'duplicate' | 'ignored' | 'rejected' };

/**
 * Verarbeitet geprüfte Stripe-Ereignisse genau einmal (Tabelle stripe_events). Freigeschaltet wird nur über
 * `BookingsService.activatePaid`, das Betrag, Währung, Buchung und Modus nochmals gegen die Datenbank prüft.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly audit: AuditService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async handle(payload: unknown): Promise<WebhookOutcome> {
    const event = parseEvent(payload);
    if (await this.prisma.stripeEvent.findUnique({ where: { id: event.id } })) return { received: true, result: 'duplicate' };

    let result: WebhookOutcome['result'] = 'ignored';
    const expectLive = this.stripe.status.keyMode === 'live';
    if (event.livemode !== expectLive || (event.livemode && !this.stripe.status.liveEnabled)) {
      // Live-Ereignis ohne Freigabe (bzw. Test-Ereignis im Live-Betrieb): nie auswerten
      this.audit.log({ action: 'billing.webhook_rejected', entityType: 'stripe_event', entityId: event.id.slice(0, 60), metadata: { type: event.type, livemode: event.livemode } });
      result = 'rejected';
    } else {
      result = await this.dispatch(event);
    }
    await this.prisma.stripeEvent.create({ data: { id: event.id, type: event.type.slice(0, 100), livemode: event.livemode } }).catch((error: unknown) => {
      // Gleichzeitig zugestellt: die Verarbeitung selbst ist idempotent
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    });
    return { received: true, result };
  }

  private async dispatch(event: StripeEvent): Promise<WebhookOutcome['result']> {
    const object = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = object as unknown as CheckoutSession;
        const bookingId = bookingOf(session);
        if (!bookingId || session.payment_status !== 'paid') return 'ignored';
        const outcome = await this.bookings.activatePaid(bookingId, session);
        return outcome === 'activated' ? 'processed' : outcome;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const bookingId = bookingOf(object as unknown as CheckoutSession);
        if (!bookingId) return 'ignored';
        await this.bookings.failPending(bookingId, event.type.endsWith('expired') ? 'EXPIRED' : 'FAILED', event.type.endsWith('expired') ? 'Checkout abgelaufen' : 'Zahlung fehlgeschlagen');
        return 'processed';
      }
      case 'charge.refunded': {
        const intent = typeof object.payment_intent === 'string' ? object.payment_intent : null;
        const refunded = typeof object.amount_refunded === 'number' ? object.amount_refunded : null;
        if (!intent || refunded === null) return 'ignored';
        return (await this.bookings.refund(intent, refunded)) === 'processed' ? 'processed' : 'ignored';
      }
      default:
        this.logger.debug(`Stripe-Ereignis ${event.type} nicht benötigt`);
        return 'ignored';
    }
  }
}

function parseEvent(payload: unknown): StripeEvent {
  const event = payload as Partial<StripeEvent> | null;
  if (
    !event ||
    typeof event.id !== 'string' ||
    !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
    typeof event.type !== 'string' ||
    typeof event.livemode !== 'boolean' ||
    !event.data ||
    typeof event.data.object !== 'object'
  ) {
    throw new BadRequestException('Ungültiges Ereignis.');
  }
  return event as StripeEvent;
}

function bookingOf(session: Pick<CheckoutSession, 'client_reference_id' | 'metadata'>) {
  const id = session.client_reference_id ?? session.metadata?.bookingId ?? null;
  return id && /^[a-z0-9]{20,40}$/.test(id) ? id : null;
}
