import { formatDate, formatPriceCents, type DealPricePoint } from '@marktat/shared';

const W = 600;
const H = 190;
const PAD = { top: 16, right: 16, bottom: 36, left: 100 };

/**
 * Preisverlauf als Stufenlinie: Jeder erfasste Preis gilt bis zur nächsten Änderung, der letzte bis heute.
 * Punkte markieren die Änderungen (Hover/Fokus zeigt Datum und Preis). Die Tabelle darunter enthält dieselben Werte.
 */
export function PriceHistoryChart({ points, now = new Date() }: { points: DealPricePoint[]; now?: Date }) {
  const steps = [...points]
    .map((p) => ({ at: new Date(p.recordedAt).getTime(), price: p.priceCents }))
    .sort((a, b) => a.at - b.at);
  if (steps.length < 2) return null;
  const start = steps[0]!.at;
  const end = Math.max(now.getTime(), steps.at(-1)!.at + 1);
  const prices = steps.map((s) => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Etwas Luft über und unter den Werten; bei gleichem Preis ein Band von ±10 %
  const span = max - min || Math.max(100, Math.round(max * 0.1));
  const low = Math.max(0, min - span * 0.15);
  const high = max + span * 0.15;
  const x = (t: number) => PAD.left + ((t - start) / (end - start)) * (W - PAD.left - PAD.right);
  const y = (cents: number) => PAD.top + (1 - (cents - low) / (high - low)) * (H - PAD.top - PAD.bottom);

  let d = `M ${x(steps[0]!.at)} ${y(steps[0]!.price)}`;
  for (const step of steps.slice(1)) d += ` H ${x(step.at)} V ${y(step.price)}`;
  d += ` H ${x(end)}`;
  const current = steps.at(-1)!;
  const ticks = max === min ? [max] : [max, min];

  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Preisverlauf: zwischen ${formatPriceCents(min)} und ${formatPriceCents(max)}, aktuell ${formatPriceCents(current.price)}`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-ink-500 text-[22px] sm:text-[12px] tabular-nums">
              {formatPriceCents(tick)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-line-strong" strokeWidth={1} />
        <text x={PAD.left} y={H - 6} className="fill-ink-500 text-[22px] sm:text-[12px]">
          {formatDate(new Date(start).toISOString())}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-ink-500 text-[22px] sm:text-[12px]">
          heute
        </text>
        <path d={d} fill="none" className="stroke-brand-600" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {steps.map((step, i) => (
          <g key={step.at} tabIndex={0} className="group outline-none">
            <title>{`${i === 0 ? 'Ab' : 'Seit'} ${formatDate(new Date(step.at).toISOString())}: ${formatPriceCents(step.price)}`}</title>
            {/* Größere, unsichtbare Fläche zum Zeigen */}
            <circle cx={x(step.at)} cy={y(step.price)} r={14} fill="transparent" />
            <circle
              cx={x(step.at)}
              cy={y(step.price)}
              r={4.5}
              className="fill-brand-600 stroke-surface group-hover:fill-brand-800 group-focus-visible:fill-brand-800"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">Die Tabelle „Alle erfassten Preise“ enthält dieselben Werte.</figcaption>
    </figure>
  );
}
