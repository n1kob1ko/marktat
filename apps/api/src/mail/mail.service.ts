import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  /** Klartext – Pflicht, damit jede E-Mail auch ohne HTML lesbar ist */
  text: string;
  html?: string;
}

/**
 * Versand über SMTP (lokal Mailpit, Produktion z. B. ein EU-Mailanbieter).
 * Ohne SMTP_HOST werden E-Mails nur protokolliert – ohne Inhalt, damit keine privaten Daten im Log landen.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly env = loadEnv();
  private readonly transport: Transporter | null = this.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_SECURE,
        auth: this.env.SMTP_USER ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD } : undefined,
        // Lokal (Mailpit) ohne TLS; sonst STARTTLS, wenn der Server es anbietet
        ignoreTLS: this.env.NODE_ENV !== 'production' && !this.env.SMTP_USER,
      })
    : null;

  get enabled() {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.log(`E-Mail nicht versendet (SMTP_HOST fehlt): „${message.subject}“`);
      return;
    }
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...message });
  }

  onModuleDestroy() {
    this.transport?.close();
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Für Werte aus Nutzereingaben (Namen, Titel) in HTML-E-Mails */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * Einheitliches, schlichtes E-Mail-Layout. `paragraphs` sind bereits escapte HTML-Absätze.
 * Der Abbestell-Hinweis verweist auf die Benachrichtigungseinstellungen im Konto.
 */
export function mailLayout(options: { heading: string; paragraphs: string[]; action: { label: string; url: string }; settingsUrl: string }) {
  const { heading, paragraphs, action, settingsUrl } = options;
  return `<!doctype html>
<html lang="de"><body style="margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#1d2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e3e1d8">
<tr><td style="padding:24px 28px 8px;font-size:20px;font-weight:bold;color:#0f4c3a">MarktAT</td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${p}</p>`).join('\n')}
<p style="margin:20px 0 24px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0f4c3a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${escapeHtml(action.label)}</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e3e1d8;font-size:12px;color:#6b716c">
Du bekommst diese E-Mail, weil du sie in deinem MarktAT-Konto aktiviert hast.
<a href="${escapeHtml(settingsUrl)}" style="color:#0f4c3a">Benachrichtigungen ändern</a>
</td></tr></table></td></tr></table></body></html>`;
}
