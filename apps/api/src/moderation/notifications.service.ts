import { Injectable, OnModuleInit } from '@nestjs/common';
import type { NotificationItem, NotificationList } from '@marktat/shared';
import type { NotificationType } from '../generated/prisma/enums.js';
import type { Notification } from '../generated/prisma/client.js';
import { loadEnv } from '../config/env.js';
import { JobsService } from '../jobs/jobs.service.js';
import { escapeHtml, mailLayout, MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const NOTIFICATION_EMAIL_JOB = 'notification-email';
const PAGE_SIZE = 30;

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Interner Pfad im Web, z. B. /konto/entscheidungen/<id> */
  link?: string;
  decisionId?: string;
}

/**
 * Mitteilungen im Konto, zusätzlich per E-Mail. Entscheidungen der Moderation sind Pflichtinformationen
 * (Art. 17 DSA) und werden unabhängig von den E-Mail-Einstellungen versendet.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register(NOTIFICATION_EMAIL_JOB, (data) => this.sendEmail(String(data.notificationId)));
  }

  async notify(input: NewNotification): Promise<void> {
    const notification = await this.prisma.notification.create({ data: input });
    await this.jobs.add(NOTIFICATION_EMAIL_JOB, { notificationId: notification.id }, { jobId: `notification-${notification.id}` });
  }

  async list(userId: string): Promise<NotificationList> {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE }),
      this.unreadCount(userId),
    ]);
    return { items: items.map(toNotificationItem), unread };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Alle (oder bestimmte) eigenen Mitteilungen als gelesen markieren. Fremde IDs werden ignoriert. */
  async markRead(userId: string, ids?: string[]): Promise<{ unread: number }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { unread: await this.unreadCount(userId) };
  }

  async sendEmail(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { email: true, displayName: true, status: true } } },
    });
    // Gelöschte Konten bekommen nichts mehr (die Mitteilung wurde mit dem Konto entfernt oder ist anonymisiert)
    if (!notification || notification.user.status === 'DELETED') return;
    const url = `${this.env.WEB_URL}${notification.link ?? '/konto/mitteilungen'}`;
    const paragraphs = notification.body.split('\n\n').filter(Boolean);
    await this.mail.send({
      to: notification.user.email,
      subject: notification.title,
      text: [`Hallo ${notification.user.displayName},`, '', ...paragraphs.flatMap((p) => [p, '']), `Details: ${url}`, '', 'Dein MarktAT-Team'].join('\n'),
      html: mailLayout({
        heading: notification.title,
        paragraphs: [`Hallo ${escapeHtml(notification.user.displayName)},`, ...paragraphs.map((p) => escapeHtml(p).replace(/\n/g, '<br>'))],
        action: { label: 'Details ansehen', url },
      }),
    });
  }
}

export function toNotificationItem(n: Notification): NotificationItem {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
