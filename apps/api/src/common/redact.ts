/** Fehlermeldungen können E-Mail-Adressen enthalten (z. B. vom SMTP-Server) – vor der Anzeige entfernen. */
export function redact(message: string): string {
  return message.replace(/[^\s<>@"']+@[^\s<>@"']+/g, '[E-Mail]').slice(0, 300);
}
