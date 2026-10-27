/**
 * IP der Besucherin bzw. des Besuchers aus X-Forwarded-For. Im Online-Betrieb setzt Caddy den Header selbst
 * (Werte von außen werden überschrieben), der erste Eintrag ist also die echte Adresse.
 *
 * Der Web-Server reicht sie an API und Supabase Auth weiter, wenn er für einen Gast bzw. beim Anmelden anfragt –
 * sonst zählten deren Rate-Limits alle Personen gemeinsam unter der IP des Web-Servers.
 */
export function clientIp(headers: Headers): string | undefined {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

/** Header für Aufrufe an Supabase Auth im Namen der Person (leer, wenn keine IP bekannt ist) */
export function forwardedFor(headers: Headers): Record<string, string> {
  const ip = clientIp(headers);
  return ip ? { 'X-Forwarded-For': ip } : {};
}
