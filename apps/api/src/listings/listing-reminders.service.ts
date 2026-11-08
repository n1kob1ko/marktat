import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatDate } from '@marktat/shared';
import { loadEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { MailService, escapeHtml, mailLayout } from '../mail/mail.service.js';

export const LISTING_REMINDER_JOB = 'listing-expiry-reminders';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** So viele Tage vor dem Ablauf kommt die Erinnerung */
export const REMINDER_DAYS = 5;
/** Nur Anzeigen, die höchstens so lange abgelaufen sind, bekommen den Hinweis (keine Nachrichtenflut nach einer Pause) */
const EXPIRED_NOTICE_WINDOW_DAYS = 3;
const BATCH = 200;
/** Höchstens so viele Anzeigen werden in einer E-Mail aufgezählt */
const MAX_LINES = 10;

type Due = { id: string; title: string; expiresAt: Date; sellerId: string; seller: { email: string; displayName: string } };

/**
 * Ablauf-E-Mails für eigene Anzeigen (Einstellung „notifyListingsByEmail“):
 * - „läuft bald ab“: REMINDER_DAYS vor dem Ablauf, einmal je Laufzeit (expiryReminderAt; Verlängern setzt zurück)
 * - „ist abgelaufen“: am Tag des Ablaufs, einmal (expiredNoticeAt)
 * Je Person eine Sammelmail statt einer E-Mail pro Anzeige. Beide Links führen zu „Meine Anzeigen“, wo
 * „Verlängern“ bzw. „Erneut veröffentlichen“ steht.
 */
@Injectable()
export class ListingRemindersService implements OnModuleInit {
  private readonly logger = new Logger(ListingRemindersService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register(LISTING_REMINDER_JOB, () => this.run().then(() => undefined));
    this.jobs.every(LISTING_REMINDER_JOB, HOUR_MS);
  }

  async run(now = new Date()): Promise<{ reminded: number; expired: number }> {
    const reminded = await this.remindExpiring(now);
    const expired = await this.noticeExpired(now);
    if (reminded || expired) this.logger.log(`Ablauf-E-Mails: ${reminded} Erinnerungen, ${expired} Abgelaufen-Hinweise`);
    return { reminded, expired };
  }

  /** Erinnerung vor dem Ablauf (aktive und pausierte Anzeigen) */
  async remindExpiring(now = new Date()): Promise<number> {
    const due = await this.collect({
      status: { in: ['ACTIVE', 'PAUSED'] },
      expiresAt: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS) },
      expiryReminderAt: null,
    });
    let sent = 0;
    for (const [, listings] of due) {
      const seller = listings[0]!.seller;
      const ids = listings.map((l) => l.id);
      const many = listings.length > 1;
      const first = listings[0]!;
      const heading = many ? `${listings.length} deiner Anzeigen laufen bald ab` : `Deine Anzeige „${first.title}“ läuft am ${formatDate(first.expiresAt)} ab`;
      const intro = many
        ? 'Diese Anzeigen laufen in den nächsten Tagen ab. Mit einem Klick verlängerst du sie kostenlos um die volle Laufzeit:'
        : 'Danach ist sie für andere nicht mehr sichtbar. Mit einem Klick verlängerst du sie kostenlos um die volle Laufzeit.';
      await this.send(seller, { heading, intro, listings, action: 'Jetzt verlängern' });
      await this.prisma.listing.updateMany({ where: { id: { in: ids }, expiryReminderAt: null }, data: { expiryReminderAt: now } });
      sent += ids.length;
    }
    return sent;
  }

  /** Hinweis nach dem Ablauf – nur für kürzlich abgelaufene Anzeigen */
  async noticeExpired(now = new Date()): Promise<number> {
    const due = await this.collect({
      status: { in: ['ACTIVE', 'PAUSED'] },
      expiresAt: { lte: now, gt: new Date(now.getTime() - EXPIRED_NOTICE_WINDOW_DAYS * DAY_MS) },
      expiredNoticeAt: null,
    });
    let sent = 0;
    for (const [, listings] of due) {
      const seller = listings[0]!.seller;
      const ids = listings.map((l) => l.id);
      const many = listings.length > 1;
      const first = listings[0]!;
      const heading = many ? `${listings.length} deiner Anzeigen sind abgelaufen` : `Deine Anzeige „${first.title}“ ist abgelaufen`;
      const intro = many
        ? 'Diese Anzeigen sind nicht mehr online. Noch nicht verkauft? Dann stell sie mit einem Klick wieder ein – kostenlos:'
        : 'Sie ist für andere nicht mehr sichtbar. Noch nicht verkauft? Dann stell sie mit einem Klick wieder ein – kostenlos.';
      await this.send(seller, { heading, intro, listings, action: 'Wieder veröffentlichen' });
      await this.prisma.listing.updateMany({ where: { id: { in: ids }, expiredNoticeAt: null }, data: { expiredNoticeAt: now } });
      sent += ids.length;
    }
    return sent;
  }

  /** Fällige Anzeigen je Anbieter:in (nur aktive Konten mit eingeschalteter Einstellung) */
  private async collect(where: { status: { in: ('ACTIVE' | 'PAUSED')[] }; expiresAt: { gt?: Date; lte?: Date }; expiryReminderAt?: null; expiredNoticeAt?: null }) {
    const grouped = new Map<string, Due[]>();
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.listing.findMany({
        where: { ...where, deletedAt: null, seller: { status: 'ACTIVE', deletedAt: null, notifyListingsByEmail: true } },
        select: { id: true, title: true, expiresAt: true, sellerId: true, seller: { select: { email: true, displayName: true } } },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1]!.id;
      for (const row of batch) {
        if (!row.expiresAt) continue;
        const list = grouped.get(row.sellerId) ?? [];
        list.push({ ...row, expiresAt: row.expiresAt });
        grouped.set(row.sellerId, list);
      }
    }
    return grouped;
  }

  private async send(seller: { email: string; displayName: string }, content: { heading: string; intro: string; listings: Due[]; action: string }) {
    const web = this.env.WEB_URL;
    const url = `${web}/konto/anzeigen`;
    const settingsUrl = `${web}/konto/benachrichtigungen`;
    const shown = content.listings.slice(0, MAX_LINES);
    const more = content.listings.length - shown.length;
    const lines = shown.map((l) => `${l.title} (bis ${formatDate(l.expiresAt)}): ${web}/anzeige/${l.id}`);
    if (more > 0) lines.push(`… und ${more} weitere`);
    const subject = content.heading.replace(/[\r\n]+/g, ' ');
    await this.mail.send({
      to: seller.email,
      subject,
      text: [`Hallo ${seller.displayName},`, '', content.intro, '', ...lines.map((l) => `- ${l}`), '', `${content.action}: ${url}`, '', `Diese E-Mails abschalten: ${settingsUrl}`].join('\n'),
      html: mailLayout({
        heading: content.heading,
        paragraphs: [
          `Hallo ${escapeHtml(seller.displayName)},`,
          escapeHtml(content.intro),
          `<ul style="margin:0;padding-left:20px">${shown
            .map((l) => `<li><a href="${escapeHtml(`${web}/anzeige/${l.id}`)}" style="color:#0f4c3a">${escapeHtml(l.title)}</a> – bis ${formatDate(l.expiresAt)}</li>`)
            .join('')}${more > 0 ? `<li>… und ${more} weitere</li>` : ''}</ul>`,
        ],
        action: { label: content.action, url },
        settingsUrl,
      }),
    });
  }
}
