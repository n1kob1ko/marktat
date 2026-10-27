/**
 * Kennung für wiederholbares Abschicken (Nachricht, neues Inserat): Die API legt je Kennung nur einen Eintrag an.
 * `crypto.randomUUID` gibt es nur in sicheren Kontexten (HTTPS, localhost) – im WLAN-Test per IP fehlt es.
 */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
