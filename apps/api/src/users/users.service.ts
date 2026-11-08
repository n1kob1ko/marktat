import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNT_TYPES,
  displayNameSchema,
  type ChangeAccountTypeInput,
  type NotificationSettingsInput,
  type UpdateProfileInput,
} from '@marktat/shared';
import type { AccountType } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CURRENT_TERMS_VERSION } from './terms.js';
import type { AccountUser, AuthUser, SupabaseClaims } from '../auth/auth.types.js';
import { DealSearchService } from '../deals/deal-search.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { toMe, toPublicSeller } from './users.mapper.js';

const LAST_SEEN_INTERVAL_MS = 15 * 60_000;
const BUSINESS_FIELDS = ['companyName', 'companyRegisterNumber', 'vatId', 'companyAddress', 'website', 'showPhone'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly searchIndex: SearchIndexService,
    private readonly dealSearch: DealSearchService,
  ) {}

  /**
   * Legt beim ersten Aufruf das App-Profil an bzw. gleicht die E-Mail ab.
   * Rollen werden NIE aus dem Token übernommen (user_metadata ist vom Benutzer veränderbar).
   */
  async syncFromClaims(claims: SupabaseClaims, ip?: string): Promise<AccountUser> {
    const email = claims.email?.toLowerCase();
    if (!email) throw new BadRequestException('Das Konto hat keine E-Mail-Adresse.');

    const select = { id: true, email: true, role: true, accountType: true, status: true, lastSeenAt: true } as const;
    const existing = await this.prisma.user.findUnique({ where: { id: claims.sub }, select });
    if (existing) {
      // Gelöschte Konten bleiben anonymisiert (die E-Mail wird nicht zurückgeschrieben)
      if (existing.status === 'DELETED') return existing;
      const now = new Date();
      const needsEmailSync = existing.email !== email;
      const needsLastSeen =
        !existing.lastSeenAt || now.getTime() - existing.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS;
      if (needsEmailSync || needsLastSeen) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { ...(needsEmailSync ? { email } : {}), lastSeenAt: now },
        });
      }
      return { ...existing, email };
    }

    const meta = claims.user_metadata ?? {};
    // Google/Apple liefern keinen Anzeigenamen, sondern den vollen Namen (full_name bzw. name)
    const provider = typeof claims.app_metadata?.['provider'] === 'string' ? claims.app_metadata['provider'] : 'email';
    const nameCandidate = [meta['display_name'], meta['full_name'], meta['name']].find((v) => typeof v === 'string' && v.trim());
    const parsedName = displayNameSchema.safeParse(typeof nameCandidate === 'string' ? nameCandidate.trim().slice(0, 50) : nameCandidate);
    const accountType: AccountType = ACCOUNT_TYPES.includes(meta['account_type'] as AccountType)
      ? (meta['account_type'] as AccountType)
      : 'PRIVATE';
    const companyName =
      accountType === 'BUSINESS' && typeof meta['company_name'] === 'string'
        ? meta['company_name'].trim().slice(0, 120)
        : null;
    // Registrierung per E-Mail schickt die akzeptierte AGB-Version mit; bei Google/Apple gilt die Zustimmung über die
    // Schaltfläche (Hinweis daneben), die Version ist dann die aktuelle
    const termsVersion =
      typeof meta['terms_version'] === 'string' ? meta['terms_version'].slice(0, 20) : provider !== 'email' ? CURRENT_TERMS_VERSION : null;

    const data = {
      id: claims.sub,
      email,
      displayName: parsedName.success ? parsedName.data : email.split('@')[0]!.slice(0, 50),
      accountType,
      companyName,
      termsVersion,
      termsAcceptedAt: termsVersion ? new Date() : null,
      lastSeenAt: new Date(),
    };
    let created;
    try {
      created = await this.prisma.user.create({ data, select });
    } catch (error) {
      // Erster Seitenaufruf schickt mehrere Anfragen gleichzeitig: Eine andere hat das Konto gerade angelegt
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const raced = await this.prisma.user.findUnique({ where: { id: claims.sub }, select });
      if (!raced) throw error;
      return raced;
    }
    this.audit.log({ action: 'user.created', actorId: created.id, entityType: 'user', entityId: created.id, ip });
    return created;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'SUSPENDED') return toMe(user);
    // Gesperrte Konten sehen die Begründung der aktuellen Sperre (Art. 17 DSA)
    const decision = await this.prisma.moderationDecision.findFirst({
      where: { userId, action: 'ACCOUNT_SUSPENDED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, statement: true },
    });
    return toMe(user, {
      decisionId: decision?.id ?? null,
      statement: decision?.statement ?? null,
      since: (user.suspendedAt ?? user.updatedAt).toISOString(),
    });
  }

  async updateNotifications(user: AuthUser, input: NotificationSettingsInput) {
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: input });
    return toMe(updated);
  }

  async updateMe(user: AuthUser, input: UpdateProfileInput, ip?: string) {
    const data: UpdateProfileInput = { ...input };
    if (user.accountType !== 'BUSINESS') {
      for (const field of BUSINESS_FIELDS) {
        if (data[field] !== undefined) {
          throw new BadRequestException('Firmenangaben sind nur bei gewerblichen Konten möglich.');
        }
      }
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data });
    this.audit.log({
      action: 'user.profile_updated',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip,
      metadata: { fields: Object.keys(input) },
    });
    return toMe(updated);
  }

  /**
   * Kontotyp privat/gewerblich wechseln – nur Administratorkonten. Sie brauchen als Betreiber keine
   * Händlerangaben (siehe DealsService.eligibility, ServiceProfilesService.me). Suchindizes werden nachgezogen,
   * weil „gewerblich“ in Inseraten und Deals sichtbar ist.
   */
  async changeAccountType(user: AuthUser, input: ChangeAccountTypeInput, ip?: string) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Den Kontotyp können nur Administratorkonten selbst ändern.');
    if (user.accountType !== input.accountType) {
      await this.prisma.user.update({ where: { id: user.id }, data: { accountType: input.accountType } });
      this.audit.log({
        action: 'user.account_type_changed',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        ip,
        metadata: { from: user.accountType, to: input.accountType },
      });
      this.searchIndex.syncSeller(user.id);
      this.dealSearch.syncMerchant(user.id);
    }
    return this.getMe(user.id);
  }

  async getPublicProfile(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        displayName: true,
        accountType: true,
        companyName: true,
        avatarUrl: true,
        logoKey: true,
        createdAt: true,
        _count: { select: { listings: { where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } } } },
      },
    });
    if (!user) throw new NotFoundException('Dieses Profil gibt es nicht.');
    return { ...toPublicSeller(user), activeListings: user._count.listings };
  }
}
