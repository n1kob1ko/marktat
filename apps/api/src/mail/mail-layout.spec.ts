import { describe, expect, it } from 'vitest';
import { mailHeaderImageUrl, mailLayout } from './mail.service.js';

describe('mailHeaderImageUrl', () => {
  it('baut eine feste Adresse in der Web-App, auch mit Schrägstrich am Ende', () => {
    expect(mailHeaderImageUrl('https://markterl.at', 'nachricht')).toBe('https://markterl.at/mail/kopf-nachricht.jpg?v=1');
    expect(mailHeaderImageUrl('https://markterl.at/', 'preisalarm')).toBe('https://markterl.at/mail/kopf-preisalarm.jpg?v=1');
  });
});

describe('mailLayout', () => {
  const base = { heading: 'Neue Nachricht', paragraphs: ['Hallo'], action: { label: 'Lesen', url: 'https://markterl.at/nachrichten' } };

  it('zeigt das Kopfbild nur, wenn eines übergeben wird – als Schmuckbild mit leerem Alt-Text', () => {
    expect(mailLayout(base)).not.toContain('<img');
    const html = mailLayout({ ...base, headerImageUrl: mailHeaderImageUrl('https://markterl.at', 'nachricht') });
    expect(html).toContain('<img src="https://markterl.at/mail/kopf-nachricht.jpg?v=1"');
    expect(html).toContain('alt=""');
  });
});
