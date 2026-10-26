import { isIPv4, isIPv6 } from 'node:net';

/**
 * Kürzt eine IP-Adresse für datensparsame Protokollierung (DSGVO):
 * IPv4 auf /24 (letztes Oktett 0), IPv6 auf /48.
 */
export function truncateIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIPv4(clean)) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (isIPv6(clean)) {
    const groups = clean.split(':').filter((g, i, arr) => g !== '' || i === 0 || i === arr.length - 1);
    return `${groups.slice(0, 3).join(':')}::`;
  }
  return null;
}
