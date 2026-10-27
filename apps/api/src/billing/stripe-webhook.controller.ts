import { BadRequestException, Controller, Headers, HttpCode, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { loadEnv } from '../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { InvalidSignatureError, verifyStripeSignature } from './stripe.gateway.js';

export const STRIPE_WEBHOOK_PATH = 'billing/stripe/webhook';

/**
 * Stripe-Webhooks. Der Rohkörper wird in setup-app.ts unverändert übernommen (für die Signaturprüfung).
 * Ohne gültige Signatur passiert nichts – auch ein gefälschtes „Zahlung erfolgreich“ schaltet nichts frei.
 */
@Controller()
export class StripeWebhookController {
  constructor(
    private readonly webhooks: StripeWebhookService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post(STRIPE_WEBHOOK_PATH)
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(@Req() req: Request, @Headers('stripe-signature') signature?: string) {
    const secret = loadEnv().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Zahlungen sind nicht eingerichtet.');
    const raw = req.body as unknown;
    if (!Buffer.isBuffer(raw) || raw.length === 0) throw new BadRequestException('Leerer Webhook.');
    try {
      verifyStripeSignature(raw, signature, secret);
    } catch (error) {
      if (!(error instanceof InvalidSignatureError)) throw error;
      this.audit.log({ action: 'billing.webhook_rejected', ip: req.ip, metadata: { reason: error.message } });
      throw new BadRequestException('Ungültige Signatur.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('Ungültiges Ereignis.');
    }
    return this.webhooks.handle(payload);
  }
}
