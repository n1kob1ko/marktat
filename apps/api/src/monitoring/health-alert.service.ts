import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { HealthCheck } from '@marktat/shared';
import { loadEnv } from '../config/env.js';
import { JobsService } from '../jobs/jobs.service.js';
import { escapeHtml, MailService, mailLayout } from '../mail/mail.service.js';
import { HealthService } from './health.service.js';

export const HEALTH_ALERT_JOB = 'health-alert';
const INTERVAL_MS = 60 * 60_000;

const LABELS: Record<string, string> = {
  database: 'Datenbank (PostgreSQL)',
  redis: 'Redis (Aufträge, Echtzeit, Rate-Limits)',
  search: 'Suche (Meilisearch)',
  auth: 'Anmeldung (Supabase Auth)',
  mail: 'E-Mail-Versand (SMTP)',
};

/**
 * Stündliche Selbstprüfung mit Alarm per E-Mail (ALERT_EMAIL): eine Nachricht, sobald eine Komponente ausfällt,
 * und eine, wenn sie wieder da ist. Ein vollständiger Ausfall der API selbst lässt sich so nicht melden – dafür
 * ist ein externer Uptime-Dienst da (docs/deployment.md). Läuft die Datenbank nicht, kommt auch keine E-Mail
 * zustande; die Prüfung selbst läuft dann ins Leere.
 */
@Injectable()
export class HealthAlertService implements OnModuleInit {
  private readonly logger = new Logger(HealthAlertService.name);
  private readonly env = loadEnv();
  /** Komponenten, für die zuletzt ein Ausfall gemeldet wurde (je Prozess) */
  private readonly alerted = new Set<string>();

  constructor(
    private readonly health: HealthService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.jobs.register(HEALTH_ALERT_JOB, () => this.run().then(() => undefined));
    if (this.env.ALERT_EMAIL) this.jobs.every(HEALTH_ALERT_JOB, INTERVAL_MS);
  }

  /** Prüft alle Komponenten und verschickt Ausfall- bzw. Erholungsmeldungen. Liefert die betroffenen Komponenten. */
  async run(now = new Date()): Promise<{ down: string[]; recovered: string[] }> {
    const to = this.env.ALERT_EMAIL;
    if (!to) return { down: [], recovered: [] };
    const checks = await this.health.checks();
    const down = Object.entries(checks).filter(([, check]) => check.status === 'down');
    const newlyDown = down.filter(([name]) => !this.alerted.has(name));
    const recovered = [...this.alerted].filter((name) => checks[name]?.status !== 'down');

    if (newlyDown.length) {
      await this.send(to, 'down', newlyDown, now);
      for (const [name] of newlyDown) this.alerted.add(name);
    }
    if (recovered.length) {
      await this.send(to, 'recovered', recovered.map((name) => [name, checks[name]!]), now);
      for (const name of recovered) this.alerted.delete(name);
    }
    return { down: down.map(([name]) => name), recovered };
  }

  private async send(to: string, kind: 'down' | 'recovered', entries: [string, HealthCheck][], now: Date) {
    const when = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' }).format(now);
    const names = entries.map(([name]) => LABELS[name] ?? name);
    const subject = kind === 'down' ? `Markterl: Störung – ${names.join(', ')}` : `Markterl: wieder in Ordnung – ${names.join(', ')}`;
    const lines = entries.map(([name, check]) => `${LABELS[name] ?? name}: ${kind === 'down' ? `ausgefallen${check.detail ? ` (${check.detail})` : ''}` : 'wieder erreichbar'}`);
    const systemUrl = `${this.env.WEB_URL}/admin/system`;
    const intro =
      kind === 'down'
        ? `Die stündliche Prüfung am ${when} hat einen Ausfall festgestellt. Die Plattform läuft eingeschränkt weiter, solange die Datenbank erreichbar ist.`
        : `Die Prüfung am ${when} meldet: Die zuvor gestörten Komponenten sind wieder erreichbar.`;
    try {
      await this.mail.send({
        to,
        subject,
        text: [intro, '', ...lines, '', `Details: ${systemUrl}`, 'Hinweise zur Fehlersuche: docs/betrieb.md'].join('\n'),
        html: mailLayout({
          heading: subject,
          paragraphs: [escapeHtml(intro), `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`],
          action: { label: 'Systemzustand öffnen', url: systemUrl },
        }),
      });
    } catch (error) {
      this.logger.warn(`Störungsmeldung konnte nicht verschickt werden: ${(error as Error).message}`);
    }
  }
}
