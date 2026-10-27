import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BillingModeInput, BillingOverview, UpdateBillingSettingsInput, UpdateProductInput } from '@marktat/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PricingService } from './pricing.service.js';
import { BookingsService } from './bookings.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway.js';

/** Felder, deren Änderung im Audit-Log mit altem und neuem Wert steht */
type Diff = Record<string, [unknown, unknown]>;

function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Diff {
  const changes: Diff = {};
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    const normalize = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    if (normalize(old) !== normalize(value)) changes[key] = [normalize(old), normalize(value)];
  }
  return changes;
}

/** Preise, Leistungen, Einführungsaktion und Betriebsmodus – nur für Administratoren, jede Änderung protokolliert. */
@Injectable()
export class BillingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
    private readonly audit: AuditService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async overview(): Promise<BillingOverview> {
    const now = new Date();
    const [settings, products, intro, counts] = await Promise.all([
      this.pricing.settings(),
      this.pricing.products(),
      this.pricing.intro(now),
      this.bookings.adminCounts(now),
    ]);
    const mode = this.pricing.effectiveMode(settings);
    return {
      settings: this.pricing.toSettingsDto(settings),
      products: products.map((p) => this.pricing.toProductDto(p, mode, now)),
      stripe: this.stripe.status,
      paidModeBlockers: this.pricing.paidModeBlockers(),
      intro,
      counts,
    };
  }

  async updateProduct(admin: AuthUser, code: string, input: UpdateProductInput, ip?: string) {
    const product = await this.prisma.product.findUnique({ where: { code } });
    if (!product) throw new NotFoundException('Diese Leistung gibt es nicht.');
    if (product.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw new ConflictException('Die Leistung wurde inzwischen geändert. Bitte lade die Seite neu.');
    }
    if (product.kind === 'LISTING' && !input.isActive) {
      throw new BadRequestException({ statusCode: 400, message: 'Das normale Inserat kann nicht abgeschaltet werden.', errors: [{ path: 'isActive', message: 'Inserate bleiben immer möglich.' }] });
    }
    if (product.kind !== 'BUMP' && input.durationDays === null) {
      throw new BadRequestException({ statusCode: 400, message: 'Bitte gib eine Laufzeit an.', errors: [{ path: 'durationDays', message: 'Bitte gib eine Laufzeit in Tagen an.' }] });
    }
    const { expectedUpdatedAt: _version, ...fields } = input;
    const data = {
      ...fields,
      // Hochschieben hat keine Laufzeit; Laufzeit-Leistungen keinen Mindestabstand
      durationDays: product.kind === 'BUMP' ? null : fields.durationDays,
      promoStartsAt: fields.promoStartsAt ? new Date(fields.promoStartsAt) : null,
      promoEndsAt: fields.promoEndsAt ? new Date(fields.promoEndsAt) : null,
    };
    const changes = diff(product as unknown as Record<string, unknown>, data);
    const updated = await this.prisma.product.updateMany({ where: { id: product.id, updatedAt: product.updatedAt }, data });
    if (!updated.count) throw new ConflictException('Die Leistung wurde inzwischen geändert. Bitte lade die Seite neu.');
    if (Object.keys(changes).length) {
      this.audit.log({ action: 'admin.product_updated', actorId: admin.id, entityType: 'product', entityId: product.code, ip, metadata: { changes } as never });
    }
    const settings = await this.pricing.settings();
    return this.pricing.toProductDto(await this.pricing.product(code), this.pricing.effectiveMode(settings));
  }

  async updateSettings(admin: AuthUser, input: UpdateBillingSettingsInput, ip?: string) {
    const settings = await this.pricing.settings();
    const data = {
      ...input,
      introStartsAt: input.introStartsAt ? new Date(input.introStartsAt) : null,
      introEndsAt: input.introEndsAt ? new Date(input.introEndsAt) : null,
    };
    const changes = diff(settings as unknown as Record<string, unknown>, data);
    const updated = await this.prisma.platformSettings.update({ where: { id: 1 }, data });
    if (Object.keys(changes).length) {
      this.audit.log({ action: 'admin.billing_settings_updated', actorId: admin.id, entityType: 'platform_settings', entityId: '1', ip, metadata: { changes } as never });
    }
    return this.pricing.toSettingsDto(updated);
  }

  /**
   * Betriebsmodus. Kostenpflichtig nur mit wörtlicher Bestätigung (Schema) UND nutzbarem Stripe. Zurück zu
   * kostenlos geht immer. Kein Zeitplan und kein Aktionsende ruft diese Funktion auf.
   */
  async setMode(admin: AuthUser, input: BillingModeInput, ip?: string) {
    const settings = await this.pricing.settings();
    if (input.mode === 'PAID') {
      const blockers = this.pricing.paidModeBlockers();
      if (blockers.length) throw new ConflictException(`Der kostenpflichtige Betrieb kann nicht eingeschaltet werden: ${blockers.join(' ')}`);
    }
    if (settings.billingMode === input.mode) return this.pricing.toSettingsDto(settings);
    const updated = await this.prisma.platformSettings.update({
      where: { id: 1 },
      data: { billingMode: input.mode, billingModeChangedAt: new Date(), billingModeChangedBy: admin.id },
    });
    this.audit.log({
      action: 'admin.billing_mode_changed',
      actorId: admin.id,
      entityType: 'platform_settings',
      entityId: '1',
      ip,
      metadata: { from: settings.billingMode, to: input.mode, stripeKeyMode: this.stripe.status.keyMode },
    });
    return this.pricing.toSettingsDto(updated);
  }
}
