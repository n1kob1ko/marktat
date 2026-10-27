import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { PublicBillingInfo } from '@marktat/shared';
import { api } from './api';

/**
 * Öffentliche Preise und Einführungsaktion – für alle gleich, kurz zwischengespeichert (Admin-Änderungen leeren „billing“).
 * Bei einer Störung null, nur für Sekunden gespeichert (siehe lib/data.ts).
 */
export async function getPublicBilling(): Promise<PublicBillingInfo | null> {
  'use cache';
  cacheTag('billing');
  try {
    const billing = await api<PublicBillingInfo>('/billing');
    cacheLife('minutes');
    return billing;
  } catch {
    cacheLife('seconds');
    return null;
  }
}

/** Neuer Schlüssel je Formular: doppelt abgeschickte Buchungen werden so nur einmal ausgeführt. */
export function newIdempotencyKey() {
  return crypto.randomUUID().replaceAll('-', '');
}
