import { formatDate } from '@marktat/shared';

const weekday = new Intl.DateTimeFormat('de-AT', { weekday: 'short', timeZone: 'Europe/Vienna' });

/**
 * Registrierungen je Tag als schlichtes Säulendiagramm (eine Reihe, Markenfarbe). Der Wert jeder Säule
 * erscheint beim Darüberfahren; für Screenreader gibt es dieselben Zahlen als Tabelle.
 */
export function RegistrationChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <figure>
      <figcaption className="text-sm text-ink-600">
        {total.toLocaleString('de-AT')} neue Konten, höchstens {max.toLocaleString('de-AT')} an einem Tag
      </figcaption>
      <div aria-hidden="true" className="mt-4 grid h-40 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-0.5 border-b border-line-strong">
        {data.map((d) => (
          <div key={d.date} className="group relative flex h-full items-end justify-center">
            <div
              className="w-full max-w-7 rounded-t-[4px] bg-brand-600 transition-colors group-hover:bg-brand-800"
              style={{ height: d.count ? `${Math.max(3, (d.count / max) * 100)}%` : '0' }}
            />
            <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-lg bg-ink-950 px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block">
              {formatDate(d.date)}: {d.count}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5 text-center text-[0.6875rem] text-ink-500">
        {data.map((d, i) => (
          <span key={d.date} className={i % 2 ? 'invisible sm:visible' : undefined}>
            {weekday.format(new Date(d.date))}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Registrierungen je Tag</caption>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Neue Konten</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{formatDate(d.date)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
