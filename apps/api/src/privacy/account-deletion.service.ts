import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AccountDeletionInput } from '@marktat/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { IMAGE_VARIANT_NAMES } from '../images/image-processor.js';
import { variantKey } from '../images/listing-images.service.js';
import { JobsService, redact } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types.js';
import { SupabaseAdminClient } from './supabase-admin.client.js';

export const DELETION_JOB = 'account-deletion';
const SWEEP_JOB = 'account-deletion-sweep';
/** Danach gilt ein Löschauftrag als fehlgeschlagen und erscheint im Admin-Dashboard */
export const MAX_DELETION_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 10 * 60_000;
/** Fehlgeschlagene Passwortprüfungen je Konto und Stunde */
const MAX_REAUTH_FAILURES = 5;

/**
 * Schritte in fester Reihenfolge. Jeder ist wiederholbar (idempotent); erledigte Schritte werden gespeichert,
 * damit ein Neustart dort weitermacht, wo er abgebrochen ist.
 */
export const DELETION_STEPS = ['auth', 'jobs', 'search', 'images', 'data'] as const;
export type DeletionStep = (typeof DELETION_STEPS)[number];

/**
 * Kontolöschung (Art. 17 DSGVO).
 *
 * 1. Antrag: Passwort erneut prüfen, Konto sofort auf DELETED setzen (kein Zugriff mehr, Inserate sofort unsichtbar)
 *    und einen Löschauftrag anlegen – beides in einer Transaktion.
 * 2. Auftrag (Hintergrund, mit Wiederholungen): Supabase-Auth-Konto, wartende Aufträge, Suchindex, Bilder in R2,
 *    Daten in PostgreSQL. Das Profil bleibt als anonymisierter Platzhalter (nur ID und Daten) für Moderations-
 *    entscheidungen mit Aufbewahrungsfrist; siehe docs/datenschutz.md.
 * 3. Scheitert ein Schritt fünfmal, wird der Auftrag als FAILED markiert und im Admin-Bereich angezeigt.
 *    Bis dahin ist das Konto bereits gesperrt und unsichtbar – es entsteht kein halb gelöschter, aktiver Zustand.
 */
@Injectable()
export class AccountDeletionService implements OnModuleInit {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly searchIndex: SearchIndexService,
    private readonly authAdmin: SupabaseAdminClient,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit() {
    this.jobs.register(DELETION_JOB, (data) => this.process(String(data.deletionId)));
    this.jobs.register(SWEEP_JOB, () => this.sweep());
    this.jobs.every(SWEEP_JOB, SWEEP_INTERVAL_MS);
  }

  async request(user: AuthUser, input: AccountDeletionInput, ip?: string): Promise<{ status: 'PENDING' | 'COMPLETED' }> {
    if (!this.authAdmin.configured) {
      throw new ServiceUnavailableException('Die Kontolöschung ist gerade nicht verfügbar. Bitte wende dich an den Support.');
    }
    const since = new Date(Date.now() - 3_600_000);
    const failures = await this.prisma.auditLog.count({ where: { actorId: user.id, action: 'privacy.reauth_failed', createdAt: { gt: since } } });
    if (failures >= MAX_REAUTH_FAILURES) {
      throw new HttpException('Zu viele Versuche. Bitte warte eine Stunde und versuche es dann erneut.', HttpStatus.TOO_MANY_REQUESTS);
    }
    let session: { userId: string; accessToken: string } | null;
    try {
      session = await this.authAdmin.verifyPassword(user.email, input.password);
    } catch (error) {
      this.logger.warn(`Passwortprüfung nicht möglich: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Die Anmeldung kann gerade nicht geprüft werden. Bitte versuche es später erneut.');
    }
    if (!session || session.userId !== user.id) {
      // Synchron protokollieren: der Zähler oben muss beim nächsten Versuch stimmen
      await this.prisma.auditLog.create({ data: { action: 'privacy.reauth_failed', actorId: user.id, entityType: 'user', entityId: user.id } });
      throw new ForbiddenException('Das Passwort ist nicht richtig.');
    }

    const deletion = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-accounts'))`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true, status: true } });
      if (current.status === 'DELETED') throw new ConflictException('Dieses Konto wird bereits gelöscht.');
      if (current.role === 'ADMIN') {
        const otherAdmins = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: user.id } } });
        if (otherAdmins === 0) {
          throw new ConflictException('Das ist das letzte aktive Administratorkonto. Vergib zuerst einem anderen Konto Administratorrechte.');
        }
      }
      await tx.user.update({ where: { id: user.id }, data: { status: 'DELETED', deletedAt: new Date() } });
      return tx.accountDeletion.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: { status: 'PENDING', attempts: 0, lastError: null },
      });
    });
    this.audit.log({ action: 'privacy.deletion_requested', actorId: user.id, entityType: 'user', entityId: user.id, ip });
    // Sofort aus der Suche nehmen; der Auftrag entfernt die Einträge danach endgültig
    this.searchIndex.syncSeller(user.id);
    // Die gerade zur Prüfung erzeugte Sitzung und alle anderen Sitzungen beenden
    await this.authAdmin.signOutEverywhere(session.accessToken);
    await this.enqueue(deletion.id);
    const state = await this.prisma.accountDeletion.findUniqueOrThrow({ where: { id: deletion.id }, select: { status: true } });
    return { status: state.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING' };
  }

  /** Admin: fehlgeschlagenen Auftrag erneut starten */
  async retry(admin: AuthUser, userId: string, ip?: string) {
    const deletion = await this.prisma.accountDeletion.findUnique({ where: { userId } });
    if (!deletion || deletion.status === 'COMPLETED') throw new ConflictException('Es gibt keinen offenen Löschauftrag für dieses Konto.');
    await this.prisma.accountDeletion.update({ where: { id: deletion.id }, data: { status: 'PENDING', attempts: 0, lastError: null } });
    this.audit.log({ action: 'admin.deletion_retried', actorId: admin.id, entityType: 'user', entityId: userId, ip });
    await this.enqueue(deletion.id);
    return this.prisma.accountDeletion.findUniqueOrThrow({ where: { id: deletion.id }, select: { status: true, completedSteps: true, attempts: true, lastError: true } });
  }

  /** Verlorene Aufträge (z. B. nach einem Neustart ohne Redis) wieder anstoßen */
  async sweep() {
    const stale = await this.prisma.accountDeletion.findMany({
      where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - SWEEP_INTERVAL_MS) } },
      select: { id: true },
      take: 20,
    });
    for (const { id } of stale) await this.enqueue(id);
  }

  private async enqueue(deletionId: string) {
    await this.jobs.add(DELETION_JOB, { deletionId }, { jobId: `account-deletion-${deletionId}` });
  }

  /** Arbeitet die offenen Schritte ab. Fehler werden gespeichert und – bis zur Höchstzahl – erneut versucht. */
  async process(deletionId: string): Promise<void> {
    const deletion = await this.prisma.accountDeletion.findUnique({ where: { id: deletionId } });
    if (!deletion || deletion.status !== 'PENDING') return;
    const done = new Set(deletion.completedSteps);
    for (const step of DELETION_STEPS) {
      if (done.has(step)) continue;
      try {
        await this.runStep(step, deletion.userId);
      } catch (error) {
        const attempts = deletion.attempts + 1;
        const failed = attempts >= MAX_DELETION_ATTEMPTS;
        await this.prisma.accountDeletion.update({
          where: { id: deletionId },
          data: { attempts, lastError: `${step}: ${redact((error as Error).message)}`.slice(0, 500), status: failed ? 'FAILED' : 'PENDING' },
        });
        if (failed) {
          this.audit.log({ action: 'privacy.deletion_failed', entityType: 'user', entityId: deletion.userId, metadata: { step } });
          this.logger.error(`Kontolöschung ${deletionId} endgültig fehlgeschlagen bei Schritt ${step}`);
          return;
        }
        throw error;
      }
      done.add(step);
      await this.prisma.accountDeletion.update({ where: { id: deletionId }, data: { completedSteps: [...done] } });
    }
    await this.prisma.accountDeletion.update({ where: { id: deletionId }, data: { status: 'COMPLETED', completedAt: new Date(), lastError: null } });
    this.audit.log({ action: 'privacy.deletion_completed', entityType: 'user', entityId: deletion.userId });
  }

  private async runStep(step: DeletionStep, userId: string) {
    switch (step) {
      case 'auth':
        return this.authAdmin.deleteUser(userId);
      case 'jobs':
        return this.cancelJobs(userId);
      case 'search':
        return this.removeFromSearch(userId);
      case 'images':
        return this.deleteImages(userId);
      case 'data':
        return this.deleteData(userId);
    }
  }

  /** Wartende E-Mails an oder über diese Person entfernen (laufende Aufträge prüfen den Kontostatus selbst). */
  private async cancelJobs(userId: string) {
    const [conversations, notifications] = await Promise.all([
      this.prisma.conversation.findMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] }, select: { id: true, buyerId: true, sellerId: true } }),
      this.prisma.notification.findMany({ where: { userId }, select: { id: true } }),
    ]);
    await this.jobs.cancel([
      ...conversations.flatMap((c) => [`message-email-${c.id}-${c.buyerId}`, `message-email-${c.id}-${c.sellerId}`]),
      ...notifications.map((n) => `notification-${n.id}`),
    ]);
  }

  private async removeFromSearch(userId: string) {
    if (!this.searchIndex.enabled) return;
    const listings = await this.prisma.listing.findMany({ where: { sellerId: userId }, select: { id: true } });
    // Das Konto ist bereits DELETED, also sind alle Inserate unsichtbar: syncNow entfernt sie aus dem Index.
    if (listings.length && !(await this.searchIndex.syncNow(listings.map((l) => l.id), true))) {
      throw new Error('Suchindex nicht erreichbar');
    }
  }

  private async deleteImages(userId: string) {
    const images = await this.prisma.listingImage.findMany({
      where: { listing: { sellerId: userId } },
      select: { storageKey: true, uploadKey: true },
    });
    const keys = images.flatMap((image) => [
      ...IMAGE_VARIANT_NAMES.map((variant) => variantKey(image.storageKey, variant)),
      ...(image.uploadKey ? [image.uploadKey] : []),
    ]);
    // Händlerlogo
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { logoKey: true } });
    if (user?.logoKey) keys.push(user.logoKey);
    for (let i = 0; i < keys.length; i += 500) await this.storage.deleteMany(keys.slice(i, i + 500));
  }

  /**
   * Löscht alle Inhalte in einer Transaktion. Bleibt: ein anonymisierter Platzhalter des Profils (für
   * Moderationsentscheidungen und Meldungen mit Aufbewahrungsfrist) – ohne E-Mail, Namen oder Kontaktdaten.
   */
  private async deleteData(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Unterhaltungen (und damit alle Nachrichten) beider Seiten – wie bisher beim Löschen eines Kontos
      await tx.conversation.deleteMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] } });
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.savedSearch.deleteMany({ where: { userId } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
      await tx.notification.deleteMany({ where: { userId } });
      // Kostenlose Buchungen löschen; bezahlte bleiben (Aufbewahrungspflicht für Buchhaltung) am Platzhalter
      await tx.booking.deleteMany({ where: { userId, priceCents: 0, payment: { is: null } } });
      // Inserate endgültig löschen: Bilder-Einträge und Merklisten anderer fallen per Cascade weg,
      // Verweise aus Meldungen und Entscheidungen werden null (der Schnappschuss in der Entscheidung bleibt).
      await tx.listing.deleteMany({ where: { sellerId: userId } });
      // Eigene Meldungen bleiben für die Moderation, aber ohne Verweis auf die meldende Person
      await tx.report.updateMany({ where: { reporterId: userId }, data: { reporterId: null } });
      await tx.report.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `geloescht-${userId}@deleted.invalid`,
          displayName: 'Gelöschtes Konto',
          role: 'USER',
          status: 'DELETED',
          avatarUrl: null,
          bio: null,
          phone: null,
          companyName: null,
          companyRegisterNumber: null,
          vatId: null,
          companyAddress: null,
          website: null,
          showPhone: false,
          logoKey: null,
          lastSeenAt: null,
          notifyMessagesByEmail: false,
          notifySearchesByEmail: false,
          reportingBlockedUntil: null,
        },
      });
    });
  }
}
