import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { PublicBillingInfo } from '@marktat/shared';
import { api } from './api';

async function cachedPublicBilling(): Promise<PublicBillingInfo> {
  'use cache';
  cacheLife('minutes');
  cacheTag('billing');
  return api<PublicBillingInfo>('/billing');
}

/**
 * Öffentliche Preise und Einführungsaktion – für alle gleich, kurz zwischengespeichert (Admin-Änderungen leeren „billing“).
 * Bei einer Störung null; der Fehler wird nicht zwischengespeichert (siehe lib/data.ts).
 */
export async function getPublicBilling(): Promise<PublicBillingInfo | null> {
  return cachedPublicBilling().catch(() => null);
}

/** Neuer Schlüssel je Formular: doppelt abgeschickte Buchungen werden so nur einmal ausgeführt. */
export function newIdempotencyKey() {
  return crypto.randomUUID().replaceAll('-', '');
}
