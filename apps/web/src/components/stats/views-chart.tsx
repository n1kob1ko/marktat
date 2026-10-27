import { formatDate } from '@marktat/shared';

/**
 * Säulen für Aufrufe pro Tag – eine Reihe, daher ohne Legende. Schmale Säulen mit runden Enden an der Grundlinie,
 * Tooltip beim Überfahren (ganze Spalte als Ziel), Tabelle für Screenreader und zum Nachlesen.
 */
export function ViewsChart({ days }: { days: { day: string; views: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.views));
  // Runde obere Achsenmarke (1, 2, 5, 10, 20, 50 …)
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map((f) => f * magnitude).find((value) => value >= max)!;
  const label = (day: string) => formatDate(`${day}T12:00:00Z`);
  const total = days.reduce((sum, d) => sum + d.views, 0);

  return (
    <div className="mt-4">
      {total === 0 ? <p className="mb-2 text-sm text-ink-600">In den letzten 30 Tagen gab es noch keine Aufrufe.</p> : null}
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between py-0 text-right text-[0.6875rem] text-ink-400 tabular-nums" aria-hidden="true">
          <span>{top.toLocaleString('de-AT')}</span>
          <span>0</span>
        </div>
        <div className="relative flex h-40 flex-1 items-end gap-[2px] border-b border-line" aria-hidden="true">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
          {days.map((d) => (
            <div key={d.day} className="group relative flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full rounded-t-[4px] bg-brand-500 transition-colors group-hover:bg-brand-700"
                style={{ height: d.views ? `${Math.max(2, (d.views / top) * 100)}%` : 0 }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-ink-950 px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block">
                {label(d.day)}: {d.views.toLocaleString('de-AT')} {d.views === 1 ? 'Aufruf' : 'Aufrufe'}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-8 text-[0.6875rem] text-ink-400" aria-hidden="true">
        <span>{days[0] ? label(days[0].day) : ''}</span>
        <span>{days.at(-1) ? label(days.at(-1)!.day) : ''}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-brand-700">Als Tabelle anzeigen</summary>
        <table className="mt-2 w-full max-w-sm text-left">
          <caption className="sr-only">Aufrufe pro Tag</caption>
          <thead>
            <tr className="text-xs text-ink-500">
              <th scope="col" className="py-1 font-medium">Tag</th>
              <th scope="col" className="py-1 text-right font-medium">Aufrufe</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1 text-ink-700">{label(d.day)}</td>
                <td className="py-1 text-right text-ink-900 tabular-nums">{d.views.toLocaleString('de-AT')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
