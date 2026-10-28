/**
 * Externe Links (Angebote, Belege, Websites): nur https, keine Zugangsdaten in der Adresse, keine IP-Adressen
 * oder internen Hostnamen und kein abweichender Port. So führt ein gespeicherter Link nie auf interne Dienste
 * oder in eine unerwartete Umgebung (javascript:, data:, file: …).
 */
export const EXTERNAL_URL_MAX_LENGTH = 500;
/** Tracking-Links der Affiliate-Netzwerke (enthalten die Zieladresse) dürfen länger sein */
export const AFFILIATE_URL_MAX_LENGTH = 1000;

export function isSafeExternalUrl(value: string, maxLength = EXTERNAL_URL_MAX_LENGTH): boolean {
  if (!value || value.length > maxLength || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  // IP-Literale (IPv4, IPv6 in eckigen Klammern) sind keine Händleradressen
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return false;
  return true;
}

/** Hostname ohne „www.“ für die Anzeige („zum Angebot auf shop.example.at“) */
export function displayHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
