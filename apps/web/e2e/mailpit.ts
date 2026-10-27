const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailSummary {
  ID: string;
  Subject: string;
}

/** Wartet auf die neueste E-Mail an `to` mit passendem Betreff und liefert den ersten Link mit token_hash. */
export async function waitForMailLink(to: string, subject: RegExp, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const mail = messages.find((m) => subject.test(m.Subject));
    if (mail) {
      const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${mail.ID}`)).json()) as { HTML: string };
      const href = detail.HTML.match(/href="([^"]*token_hash=[^"]*)"/)?.[1];
      if (href) return href.replaceAll('&amp;', '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Keine E-Mail „${subject}“ an ${to} erhalten`);
}

/** Wartet auf eine E-Mail an `to` mit passendem Betreff und liefert deren Text. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 20_000): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const mail = messages.find((m) => subject.test(m.Subject));
    if (mail) {
      const detail = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
      return { subject: mail.Subject, text: detail.Text };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Keine E-Mail „${subject}“ an ${to} erhalten`);
}

/** Alle E-Mails an `to` (für „keine doppelte Benachrichtigung“) */
export async function mailCount(to: string, subject: RegExp): Promise<number> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const { messages } = (await res.json()) as { messages: MailSummary[] };
  return messages.filter((m) => subject.test(m.Subject)).length;
}
