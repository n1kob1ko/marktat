import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { MfaFactorSummary } from '@marktat/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isStaffRole } from '../auth/mfa.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthAdminUnavailableError, SupabaseAdminClient } from '../privacy/supabase-admin.client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verwaltung der Zwei-Faktor-Anmeldung aus Sicht der API. Einrichten und Bestätigen läuft in der Web-App direkt
 * über Supabase Auth (die Sitzung gehört dorthin); die API protokolliert Änderungen anhand des tatsächlichen
 * Stands in Supabase und erlaubt Administratoren, die 2FA eines anderen Kontos zurückzusetzen (Aussperr-Schutz).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAdmin: SupabaseAdminClient,
    private readonly audit: AuditService,
  ) {}

  /** Nach Einrichten oder Entfernen: Stand aus Supabase lesen und protokollieren (keine Angaben vom Client übernommen). */
  async recordChange(user: AuthUser, event: 'enrolled' | 'removed', ip?: string) {
    if (!isStaffRole(user.role)) throw new ForbiddenException('Die Zwei-Faktor-Anmeldung ist derzeit für das Team vorgesehen.');
    const factors = await this.factors(user.id);
    const verified = factors.filter((f) => f.verified).length;
    this.audit.log({
      action: event === 'enrolled' ? 'security.mfa_enrolled' : 'security.mfa_removed',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip,
      metadata: { verifiedFactors: verified },
    });
    return { verifiedFactors: verified };
  }

  async factorsFor(id: string): Promise<{ factors: MfaFactorSummary[] }> {
    await this.requireUser(id);
    const factors = await this.factors(id);
    return {
      factors: factors
        .filter((f) => f.verified)
        .map((f) => ({ friendlyName: f.friendlyName, createdAt: f.createdAt, type: f.type })),
    };
  }

  /** Entfernt alle Faktoren eines anderen Kontos – danach meldet es sich nur mit Passwort an und richtet 2FA neu ein. */
  async reset(admin: AuthUser, id: string, ip?: string) {
    if (id === admin.id) {
      throw new ForbiddenException('Deine eigene Zwei-Faktor-Anmeldung verwaltest du unter „Sicherheit“ in deinem Konto.');
    }
    await this.requireUser(id);
    const factors = await this.factors(id);
    for (const factor of factors) await this.call(() => this.authAdmin.deleteFactor(id, factor.id));
    this.audit.log({
      action: 'admin.mfa_reset',
      actorId: admin.id,
      entityType: 'user',
      entityId: id,
      ip,
      metadata: { removedFactors: factors.length },
    });
    return { removedFactors: factors.length };
  }

  private async requireUser(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Dieses Konto gibt es nicht.');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { status: true } });
    if (!user || user.status === 'DELETED') throw new NotFoundException('Dieses Konto gibt es nicht.');
  }

  private factors(id: string) {
    return this.call(() => this.authAdmin.listFactors(id));
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthAdminUnavailableError) {
        throw new ServiceUnavailableException('Die Anmeldeverwaltung ist gerade nicht erreichbar. Bitte versuche es später erneut.');
      }
      throw error;
    }
  }
}
