import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { AdminBillingController } from './admin-billing.controller.js';
import { BillingAdminService } from './billing-admin.service.js';
import { BillingController } from './billing.controller.js';
import { BookingsService } from './bookings.service.js';
import { PricingService } from './pricing.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { HttpStripeGateway, STRIPE_GATEWAY } from './stripe.gateway.js';

/** Leistungen, Preise, Buchungen und Zahlungen (Phase 7). Zum Start kostenlos, siehe docs/monetarisierung.md. */
@Module({
  controllers: [BillingController, AdminBillingController, StripeWebhookController],
  providers: [
    { provide: STRIPE_GATEWAY, useFactory: () => new HttpStripeGateway(loadEnv()) },
    PricingService,
    BookingsService,
    BillingAdminService,
    StripeWebhookService,
  ],
  exports: [PricingService, BookingsService],
})
export class BillingModule {}
