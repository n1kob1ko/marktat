import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { loadEnv } from '../config/env.js';
import { escapeHtml, MailService, mailLayout } from '../mail/mail.service.js';

/**
 * Passwort- und E-Mail-Änderungen laufen in der Web-App direkt über Supabase Auth (die Sitzung gehört dorthin).
 * Die API protokolliert sie und warnt bei einem geänderten Passwort per E-Mail – falls es nicht die Kontoinhaberin
 * bzw. der Kontoinhaber war, bleibt so die Chance, rasch zu reagieren. Für die E-Mail-Änderung verschickt
 * Supabase Auth selbst Bestätigungen an beide Adressen.
 */
@Injectable()
export class SecurityEventsService {
  constructor(
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async record(user: AuthUser, event: 'password_changed' | 'email_change_requested', ip?: string) {
    this.audit.log({
      action: event === 'password_changed' ? 'security.password_changed' : 'security.email_change_requested',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ip,
    });
    if (event === 'password_changed') await this.notifyPasswordChanged(user.email);
    return { ok: true };
  }

  private async notifyPasswordChanged(to: string) {
    const webUrl = loadEnv().WEB_URL;
    const resetUrl = `${webUrl}/passwort-vergessen`;
    const when = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' }).format(new Date());
    await this.mail
      .send({
        to,
        subject: 'Dein Passwort wurde geändert',
        text: [
          `Das Passwort deines Markterl-Kontos wurde am ${when} geändert.`,
          '',
          'Warst du das nicht? Dann setze dein Passwort sofort zurück und prüfe die Sicherheitseinstellungen deines Kontos:',
          resetUrl,
          '',
          'Warst du es selbst, musst du nichts weiter tun.',
        ].join('\n'),
        html: mailLayout({
          heading: 'Dein Passwort wurde geändert',
          paragraphs: [
            `Das Passwort deines Markterl-Kontos wurde am ${escapeHtml(when)} geändert.`,
            '<strong>Warst du das nicht?</strong> Dann setze dein Passwort sofort zurück und prüfe die Sicherheitseinstellungen deines Kontos.',
            'Warst du es selbst, musst du nichts weiter tun.',
          ],
          action: { label: 'Passwort zurücksetzen', url: resetUrl },
        }),
      })
      .catch(() => undefined);
  }
}
