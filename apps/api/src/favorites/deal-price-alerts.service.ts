import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatPriceCents } from '@marktat/shared';
import { loadEnv } from '../config/env.js';
import { publicDealWhere } from '../deals/deals.mapper.js';
import { JobsService } from '../jobs/jobs.service.js';
import { escapeHtml, MailService, mailLayout } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ALERT_JOB = 'deal-price-alerts';
const BATCH = 500;
/** So viele Deals stehen höchstens in einer E-Mail; der Rest folgt mit der nächsten Prüfung */
const MAX_LINES = 10;

interface Drop {
  dealId: string;
  title: string;
  before: number;
  now: number;
}

/**
 * Preisalarm für gemerkte Deals: Fällt der Preis unter den Preis beim Einschalten (bzw. bei der letzten E-Mail), gibt es
 * eine Sammelmail je Person. Danach gilt der neue Preis als Ausgangspunkt – jede weitere Senkung meldet sich wieder.
 * Abschaltbar wie gespeicherte Suchen (Einstellung „notifySearchesByEmail“).
 */
@Injectable()
export class DealPriceAlertsService implements OnModuleInit {
  private readonly logger = new Logger(DealPriceAlertsService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register(ALERT_JOB, () => this.run().then(() => undefined));
    this.jobs.every(ALERT_JOB, this.env.SAVED_SEARCH_ALERT_MINUTES * 60_000);
  }

  async run(now = new Date()): Promise<{ notified: number; deals: number }> {
    const byUser = new Map<string, { email: string; displayName: string; drops: Drop[] }>();
    let cursor: { userId: string; dealId: string } | undefined;
    for (;;) {
      const rows = await this.prisma.dealFavorite.findMany({
        where: { priceAlert: true, alertPriceCents: { not: null }, deal: publicDealWhere(now), user: { status: 'ACTIVE', deletedAt: null, notifySearchesByEmail: true } },
        select: {
          userId: true,
          dealId: true,
          alertPriceCents: true,
          deal: { select: { title: true, priceCents: true } },
          user: { select: { email: true, displayName: true } },
        },
        orderBy: [{ userId: 'asc' }, { dealId: 'asc' }],
        take: BATCH,
        ...(cursor && { cursor: { userId_dealId: cursor }, skip: 1 }),
      });
      if (!rows.length) break;
      const last = rows.at(-1)!;
      cursor = { userId: last.userId, dealId: last.dealId };
      for (const row of rows) {
        if (row.deal.priceCents >= row.alertPriceCents!) continue;
        const entry = byUser.get(row.userId) ?? { email: row.user.email, displayName: row.user.displayName, drops: [] };
        entry.drops.push({ dealId: row.dealId, title: row.deal.title, before: row.alertPriceCents!, now: row.deal.priceCents });
        byUser.set(row.userId, entry);
      }
    }

    let notified = 0;
    let deals = 0;
    for (const [userId, entry] of byUser) {
      const drops = entry.drops.sort((a, b) => b.before - b.now - (a.before - a.now)).slice(0, MAX_LINES);
      try {
        await this.send(entry.email, entry.displayName, drops);
      } catch (error) {
        this.logger.warn(`Preisalarm für ${userId} nicht versendet: ${(error as Error).message}`);
        continue;
      }
      for (const drop of drops) {
        // Nur, wenn der Preis seitdem nicht schon wieder geändert wurde
        await this.prisma.dealFavorite.updateMany({
          where: { userId, dealId: drop.dealId, priceAlert: true },
          data: { alertPriceCents: drop.now, alertNotifiedAt: now },
        });
      }
      notified++;
      deals += drops.length;
    }
    return { notified, deals };
  }

  private async send(to: string, displayName: string, drops: Drop[]) {
    const web = this.env.WEB_URL;
    const settingsUrl = `${web}/konto/benachrichtigungen`;
    const listUrl = `${web}/konto/merkliste?art=deals`;
    const subject = drops.length === 1 ? `Preis gesunken: ${drops[0]!.title}` : `${drops.length} gemerkte Deals sind günstiger geworden`;
    const line = (d: Drop) => `${d.title}: jetzt ${formatPriceCents(d.now)} statt ${formatPriceCents(d.before)}`;
    await this.mail.send({
      to,
      subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 150),
      text: [
        `Hallo ${displayName},`,
        '',
        drops.length === 1 ? 'ein Deal mit Preisalarm ist günstiger geworden:' : 'diese Deals mit Preisalarm sind günstiger geworden:',
        '',
        ...drops.map((d) => `- ${line(d)}: ${web}/deals/${d.dealId}`),
        '',
        'Preise laut Händler bzw. Produktfeed; maßgeblich ist der Preis im Shop.',
        '',
        `Deine gemerkten Deals: ${listUrl}`,
        `Benachrichtigungen ändern: ${settingsUrl}`,
      ].join('\n'),
      html: mailLayout({
        heading: subject,
        paragraphs: [
          `Hallo ${escapeHtml(displayName)},`,
          drops.length === 1 ? 'ein Deal mit Preisalarm ist günstiger geworden:' : 'diese Deals mit Preisalarm sind günstiger geworden:',
          drops
            .map(
              (d) =>
                `<a href="${escapeHtml(`${web}/deals/${d.dealId}`)}" style="color:#0f4c3a">${escapeHtml(d.title)}</a> – jetzt <strong>${escapeHtml(formatPriceCents(d.now))}</strong> statt ${escapeHtml(formatPriceCents(d.before))}`,
            )
            .join('<br>'),
          'Preise laut Händler bzw. Produktfeed; maßgeblich ist der Preis im Shop.',
        ],
        action: drops.length === 1 ? { label: 'Zum Deal', url: `${web}/deals/${drops[0]!.dealId}` } : { label: 'Gemerkte Deals ansehen', url: listUrl },
        settingsUrl,
      }),
    });
  }
}
