'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Select, Textarea } from '@marktat/ui';
import type { AffiliateProgramView, DealCategoryView } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { StepUpField } from '@/components/security/step-up-field';
import { reviewAffiliateProgramAction } from '@/app/admin/actions';

/**
 * Freigabe eines Partnerprogramms. Eigene Formularkomponente, damit Dokumentation und Häkchen nach einem Fehler
 * erhalten bleiben (React setzt Formulare nach jeder Aktion zurück).
 */
export function AffiliateProgramForm({
  program,
  categories,
  stepUp,
}: {
  program: AffiliateProgramView;
  categories: DealCategoryView[];
  stepUp: { enabled: boolean; maxAgeMinutes: number };
}) {
  const [state, formAction] = useActionState(reviewAffiliateProgramAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  const kept = state.status === 'error' ? state.values : undefined;
  const checked = (key: 'allowImages' | 'allowReferencePrices' | 'allowVouchers') => (kept ? kept[key] === 'on' : program[key]);
  return (
    <form action={formAction} className="mt-3 space-y-3">
      {state.status !== 'idle' && state.message ? <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert> : null}
      <input type="hidden" name="id" value={program.id} />
      {program.membership !== 'JOINED' ? (
        <Alert tone="warning">Freigeben geht erst, wenn Awin die Partnerschaft als aktiv meldet. Bewirb dich im Awin-Publisher-Bereich beim Programm.</Alert>
      ) : null}
      <Field label="Dokumentation (Pflicht)" hint="Freigabe: mindestens 20 Zeichen, z. B. Datum der Partnerschaft, geprüfte Programmbedingungen, Bildrechte." error={errors.note}>
        <Textarea name="note" rows={3} maxLength={1000} className="min-h-24" defaultValue={kept?.note ?? program.approvalNote ?? ''} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink-800">Laut Programmbedingungen erlaubt</legend>
        <Checkbox name="allowImages" defaultChecked={checked('allowImages')} label="Produktbilder des Händlers anzeigen (unverändert)" />
        <Checkbox name="allowReferencePrices" defaultChecked={checked('allowReferencePrices')} label="Vergleichspreis (UVP/RRP aus dem Feed) als Rabatt zeigen" />
        <Checkbox name="allowVouchers" defaultChecked={checked('allowVouchers')} label="Gutscheincodes veröffentlichen" />
      </fieldset>
      <Field label="Standardkategorie (wenn keine passt)" error={errors.defaultCategorySlug}>
        <Select name="defaultCategorySlug" defaultValue={kept?.defaultCategorySlug ?? program.defaultCategorySlug ?? ''}>
          <option value="">Automatisch (sonst „Sonstige Angebote“)</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
      </Field>
      <StepUpField {...stepUp} error={errors.mfaCode} />
      <div className="flex flex-wrap gap-2">
        {program.membership === 'JOINED' ? (
          <SubmitButton size="sm" name="decision" value="APPROVE">
            {program.status === 'APPROVED' ? 'Freigabe aktualisieren' : 'Freigeben'}
          </SubmitButton>
        ) : null}
        {program.status === 'APPROVED' ? (
          <SubmitButton size="sm" variant="outline" name="decision" value="PAUSE">
            Anhalten
          </SubmitButton>
        ) : null}
        {program.status !== 'REJECTED' ? (
          <SubmitButton size="sm" variant="ghost" name="decision" value="REJECT">
            Ablehnen
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
