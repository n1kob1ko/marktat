/**
 * Fehlermeldungen können E-Mail-Adressen (z. B. vom SMTP-Server) oder Zugangsschlüssel in Adressen enthalten
 * (Awin-Feeds: „/apikey/…“, „accessToken=…“) – vor der Anzeige und Protokollierung entfernen.
 */
export function redact(message: string): string {
  return message
    .replace(/[^\s<>@"']+@[^\s<>@"']+/g, '[E-Mail]')
    .replace(/(apikey\/)[^/\s"']+/gi, '$1[Schlüssel]')
    .replace(/((?:access_?token|api_?key|token)=)[^&\s"']+/gi, '$1[Schlüssel]')
    .replace(/(Bearer\s+)[\w.~+/-]+=*/gi, '$1[Schlüssel]')
    .slice(0, 300);
}
