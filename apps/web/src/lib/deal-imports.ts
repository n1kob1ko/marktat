import type { DealImportSummary } from '@marktat/shared';

/** Kurzfassung eines Importergebnisses, z. B. „3 neu · 1 aktualisiert · 0 unverändert · 2 mit Fehler“ */
export function importCountsText(summary: Pick<DealImportSummary, 'counts' | 'status'>) {
  const c = summary.counts;
  if (summary.status === 'FAILED' || (c.total === 0 && !c.ended)) return '';
  const parts = [`${c.create} neu`, `${c.update} aktualisiert`, `${c.unchanged} unverändert`];
  if (c.ended) parts.push(`${c.ended} beendet`);
  if (c.skip) parts.push(`${c.skip} übersprungen`);
  if (c.error) parts.push(`${c.error} mit Fehler`);
  return parts.join(' · ');
}

/** Kurze Herkunftsbezeichnung für Listen */
export const IMPORT_SOURCE_LABELS = { MANUAL: 'Formular', CSV: 'CSV-Import', FEED: 'Feed' } as const;
