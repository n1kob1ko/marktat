import Link from 'next/link';
import { DEAL_IMPORT_ACTION_LABELS, type DealImportAction, type DealImportRowResult } from '@marktat/shared';
import { Badge, type BadgeTone } from '@marktat/ui';

const TONES: Record<DealImportAction, BadgeTone> = {
  CREATE: 'success',
  UPDATE: 'brand',
  UNCHANGED: 'neutral',
  SKIP: 'warning',
  END: 'warning',
  ERROR: 'danger',
};

/** Ergebnis bzw. Vorschau je Zeile: was passiert, was sich ändert, welche Fehler und Hinweise es gibt */
export function DealImportRows({ rows, dealHref }: { rows: DealImportRowResult[]; dealHref?: (id: string) => string }) {
  if (!rows.length) return <p className="text-sm text-ink-500">Die Datei enthält keine Zeilen.</p>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full min-w-[44rem] text-left text-sm" data-testid="deal-import-rows">
        <thead className="border-b border-line bg-canvas text-xs font-semibold text-ink-600 uppercase">
          <tr>
            <th className="px-3 py-2">Zeile</th>
            <th className="px-3 py-2">Artikelnummer</th>
            <th className="px-3 py-2">Titel</th>
            <th className="px-3 py-2">Ergebnis</th>
            <th className="px-3 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.line}-${index}`} className="border-b border-line align-top last:border-b-0">
              <td className="px-3 py-2 tabular-nums text-ink-500">{row.line || '–'}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.externalId ?? '–'}</td>
              <td className="max-w-[18rem] px-3 py-2">
                {row.dealId && dealHref ? (
                  <Link href={dealHref(row.dealId)} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">{row.title ?? 'Angebot'}</Link>
                ) : (
                  (row.title ?? '–')
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Badge tone={TONES[row.action]}>{DEAL_IMPORT_ACTION_LABELS[row.action]}</Badge>
              </td>
              <td className="space-y-1 px-3 py-2">
                {row.changes.length ? <p className="text-ink-700">Ändert: {row.changes.join(', ')}</p> : null}
                {row.messages.map((m, i) => (
                  <p key={`m${i}`} className={row.action === 'ERROR' ? 'text-danger-600' : 'text-ink-700'}>{m}</p>
                ))}
                {row.warnings.map((w, i) => (
                  <p key={`w${i}`} className="text-warning-700">{w}</p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
