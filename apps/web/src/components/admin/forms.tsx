'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { Alert, Checkbox, Field, Select, Textarea } from '@marktat/ui';
import { DECISION_GROUND_LABELS, DECISION_GROUNDS, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '@marktat/shared';
import { initialFormState, type FormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { StepUpField } from '@/components/security/step-up-field';
import {
  decideAppealAction,
  decideDealAction,
  decideListingAction,
  decidePortfolioItemAction,
  decideServiceProfileAction,
  decideUserAction,
  dealsBlockAction,
  dismissReportAction,
} from '@/app/admin/actions';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function StateAlert({ state }: { state: FormState }) {
  if (state.status === 'idle' || !state.message) return null;
  return <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert>;
}

/** Einfaches Formular mit Rückmeldung (Zuständigkeit, Rolle, Einschränkungen …) */
export function ActionForm({ action, children, className }: { action: Action; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className={className ?? 'space-y-3'}>
      <StateAlert state={state} />
      {children}
    </form>
  );
}

export interface DecisionOption {
  value: string;
  label: string;
  description: string;
  /** Einschränkend: braucht Verstoß und Rechtsgrundlage */
  restrictive: boolean;
}

const DECISION_ACTIONS = {
  listing: decideListingAction,
  user: decideUserAction,
  deal: decideDealAction,
  serviceProfile: decideServiceProfileAction,
  portfolioItem: decidePortfolioItemAction,
  dealsBlock: dealsBlockAction,
} satisfies Record<string, Action>;

/**
 * Entscheidung über ein Inserat, einen Deal oder ein Konto. Die Begründung geht wörtlich an die betroffene Person
 * (Art. 17 DSA), die interne Notiz sieht nur das Team.
 */
export function DecisionForm({
  target,
  id,
  options,
  version,
  reportId,
  defaultReason,
  stepUp,
  hidden,
}: {
  /** Zusätzliche versteckte Felder (z. B. das Profil, zu dem ein Portfolio-Eintrag gehört) */
  hidden?: Record<string, string>;
  /** Kritische Aktion (Kontosperre): Bestätigungscode abfragen, wenn die Sitzung 2FA nutzt */
  stepUp?: { enabled: boolean; maxAgeMinutes: number };
  target: keyof typeof DECISION_ACTIONS;
  id: string;
  options: DecisionOption[];
  version?: string;
  reportId?: string;
  defaultReason?: ReportReason;
}) {
  const [state, formAction] = useActionState(DECISION_ACTIONS[target], initialFormState);
  const [choice, setDecision] = useState(state.values?.decision ?? options[0]?.value ?? '');
  // Nach einer Entscheidung ändert sich der Status und damit die möglichen Maßnahmen
  const decision = options.some((o) => o.value === choice) ? choice : (options[0]?.value ?? '');
  const selected = options.find((o) => o.value === decision);
  const errors = state.fieldErrors ?? {};
  if (!options.length) return <p className="text-sm text-ink-500">In diesem Status ist keine Entscheidung möglich.</p>;

  return (
    <form action={formAction} className="space-y-4">
      <StateAlert state={state} />
      <input type="hidden" name="id" value={id} />
      {version ? <input type="hidden" name="version" value={version} /> : null}
      {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">Maßnahme</legend>
        <div className="mt-2 space-y-2">
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input type="radio" name="decision" value={o.value} checked={decision === o.value} onChange={() => setDecision(o.value)} className="mt-0.5 size-4 accent-brand-700" />
              <span className="text-sm">
                <span className="font-semibold text-ink-900">{o.label}</span>
                <span className="block text-ink-600">{o.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {selected?.restrictive ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Art des Verstoßes" error={errors.reason} required>
            <Select name="reason" defaultValue={state.values?.reason ?? defaultReason ?? ''}>
              <option value="">Bitte wählen</option>
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>{REPORT_REASON_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Rechtsgrundlage" error={errors.ground} required>
            <Select name="ground" defaultValue={state.values?.ground ?? 'TERMS'}>
              {DECISION_GROUNDS.map((g) => (
                <option key={g} value={g}>{DECISION_GROUND_LABELS[g]}</option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <Field
        label="Begründung für die betroffene Person"
        hint="Wird wörtlich per E-Mail und im Konto angezeigt. Sachlich, konkret, ohne interne Details."
        error={errors.statement}
        required
      >
        <Textarea name="statement" rows={4} maxLength={2000} defaultValue={state.values?.statement} />
      </Field>
      <Field label="Interne Notiz" hint="Nur für das Team sichtbar." error={errors.internalNote}>
        <Textarea name="internalNote" rows={2} maxLength={1000} className="min-h-20" defaultValue={state.values?.internalNote} />
      </Field>
      {errors.version ? <p className="text-sm font-medium text-danger-600">{errors.version[0]}</p> : null}
      <StepUpField enabled={Boolean(stepUp?.enabled)} maxAgeMinutes={stepUp?.maxAgeMinutes} error={errors.mfaCode} />
      <SubmitButton variant={selected?.restrictive ? 'danger' : 'primary'}>{selected ? `${selected.label} – bestätigen` : 'Entscheiden'}</SubmitButton>
    </form>
  );
}

export function DismissReportForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(dismissReportAction, initialFormState);
  return (
    <form action={formAction} className="space-y-3">
      <StateAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <Field label="Notiz (intern)" error={state.fieldErrors?.note}>
        <Textarea name="note" rows={2} maxLength={1000} className="min-h-20" defaultValue={state.values?.note} />
      </Field>
      <Checkbox
        name="abusive"
        label={
          <>
            <span className="font-semibold text-ink-900">Offensichtlich unbegründet</span> – zählt für das Meldeverhalten der meldenden Person (Art. 23 DSA). Führt nie automatisch zu einer
            Einschränkung.
          </>
        }
      />
      <SubmitButton variant="outline">Kein Verstoß – Meldung schließen</SubmitButton>
    </form>
  );
}

export function AppealDecisionForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(decideAppealAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <StateAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">Ergebnis</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
            <input type="radio" name="outcome" value="REVERSED" defaultChecked={state.values?.outcome === 'REVERSED'} required className="mt-0.5 size-4 accent-brand-700" />
            <span className="text-sm">
              <span className="font-semibold text-ink-900">Stattgeben</span>
              <span className="block text-ink-600">Die Entscheidung wird aufgehoben, Inserat bzw. Konto wieder freigegeben.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
            <input type="radio" name="outcome" value="UPHELD" defaultChecked={state.values?.outcome === 'UPHELD'} className="mt-0.5 size-4 accent-brand-700" />
            <span className="text-sm">
              <span className="font-semibold text-ink-900">Ablehnen</span>
              <span className="block text-ink-600">Die Entscheidung bleibt bestehen.</span>
            </span>
          </label>
        </div>
        {errors.outcome ? <p className="mt-1 text-sm font-medium text-danger-600">{errors.outcome[0]}</p> : null}
      </fieldset>
      <Field label="Antwort an die Person" hint="Begründe das Ergebnis. Die Antwort wird per E-Mail und im Konto angezeigt." error={errors.response} required>
        <Textarea name="response" rows={4} maxLength={2000} defaultValue={state.values?.response} />
      </Field>
      <SubmitButton>Einspruch entscheiden</SubmitButton>
    </form>
  );
}
