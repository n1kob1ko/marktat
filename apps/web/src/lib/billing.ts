import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { PublicBillingInfo } from '@marktat/shared';
import { api } from './api';

/** Öffentliche Preise und Einführungsaktion – für alle gleich, kurz zwischengespeichert (Admin-Änderungen leeren „billing“). */
export async function getPublicBilling(): Promise<PublicBillingInfo | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag('billing');
  try {
    return await api<PublicBillingInfo>('/billing');
  } catch {
    return null;
  }
}

/** Neuer Schlüssel je Formular: doppelt abgeschickte Buchungen werden so nur einmal ausgeführt. */
export function newIdempotencyKey() {
  return crypto.randomUUID().replaceAll('-', '');
}
