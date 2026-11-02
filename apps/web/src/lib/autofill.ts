import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { AutofillStatus } from '@marktat/shared';
import { api } from './api';

/** Ist der Foto-Assistent eingeschaltet? Für alle gleich, kurz zwischengespeichert. Bei einer Störung: aus. */
export async function getAutofillStatus(): Promise<AutofillStatus> {
  'use cache';
  cacheTag('autofill');
  try {
    const status = await api<AutofillStatus>('/autofill/status');
    cacheLife('minutes');
    return { enabled: status.enabled === true };
  } catch {
    cacheLife('seconds');
    return { enabled: false };
  }
}
