'use client';

import { useActionState } from 'react';
import { Alert } from '@marktat/ui';
import type { DealDisplayStatus } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { dealOpAction } from '@/app/konto/deals/actions';
import { SubmitButton } from '@/components/submit-button';

const LABELS = {
  publish: 'Veröffentlichen',
  verify: 'Gilt weiterhin',
  pause: 'Pausieren',
  resume: 'Fortsetzen',
  resubmit: 'Erneut prüfen lassen',
  delete: 'Löschen',
} as const;

type Op = keyof typeof LABELS;

/** Welche Aktionen im jeweiligen Status möglich sind (die API prüft dasselbe) */
export function dealOps(status: DealDisplayStatus): Op[] {
  switch (status) {
    case 'DRAFT':
      return ['publish', 'delete'];
    case 'ACTIVE':
    case 'SCHEDULED':
    case 'SOLD_OUT':
      return ['verify', 'pause', 'delete'];
    case 'UNVERIFIED':
      return ['verify', 'pause', 'delete'];
    case 'PAUSED':
      return ['resume', 'verify', 'delete'];
    case 'PENDING_REVIEW':
      return ['verify', 'delete'];
    case 'REJECTED':
      return ['resubmit', 'delete'];
    default:
      return ['delete'];
  }
}

/** Knöpfe für Statuswechsel; Fehler der API (z. B. fehlende Berechtigung) erscheinen direkt darüber. */
export function DealActions({ id, status, back, compact = false }: { id: string; status: DealDisplayStatus; back?: 'list'; compact?: boolean }) {
  const [state, action] = useActionState(dealOpAction, initialFormState);
  const ops = dealOps(status);
  return (
    <form action={action} className="space-y-2">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <div className="flex flex-wrap gap-2">
        {ops.map((op) => (
          <SubmitButton
            key={op}
            name="op"
            value={op}
            size="sm"
            variant={op === 'delete' ? 'ghost' : op === ops[0] ? 'primary' : 'outline'}
            className={op === 'delete' ? 'text-danger-600' : undefined}
            aria-label={compact ? `${LABELS[op]}` : undefined}
          >
            {LABELS[op]}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}
