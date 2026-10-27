import type { ReactNode } from 'react';
import { Badge } from '@marktat/ui';

/** Eine Angabe auf einer Rechtsseite – fehlt sie, steht sichtbar „Angabe fehlt noch“ statt eines erfundenen Werts. */
export function LegalFact({ label, value, children }: { label: string; value: string | null; children?: ReactNode }) {
  return (
    <li>
      <span className="font-medium text-ink-900">{label}:</span>{' '}
      {value ? (children ?? value) : <Missing />}
    </li>
  );
}

export function Missing() {
  return <Badge tone="warning">Angabe fehlt noch</Badge>;
}

/** Wert oder Platzhalter für Fließtext */
export function Fact({ value }: { value: string | null }) {
  return value ? <>{value}</> : <Missing />;
}
