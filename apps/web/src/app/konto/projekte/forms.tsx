'use client';

import { useActionState, useState } from 'react';
import { Alert, Checkbox, Field, Input, Label, Select, Textarea } from '@marktat/ui';
import {
  PROJECT_BUDGET_TYPES,
  PROJECT_BUDGET_TYPE_LABELS,
  PROJECT_EXTEND_WINDOW_DAYS,
  PROJECT_RUN_DAYS,
  SERVICE_CATEGORY_GROUPS,
  type MyServiceProject,
} from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { LocationInput } from '@/components/search/location-input';
import { SubmitButton } from '@/components/submit-button';
import { projectOpAction, saveProjectAction } from './actions';

const DAY_MS = 86_400_000;
const centsToInput = (cents: number | null | undefined) => (cents ? (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) : '');

/** Projektauftrag beschreiben bzw. bearbeiten – ein konkretes Vorhaben für eine selbstständige Dienstleistung, kein Stellenangebot. */
export function ProjectForm({ project }: { project: MyServiceProject | null }) {
  const [state, action] = useActionState(saveProjectAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  const [budgetType, setBudgetType] = useState(v?.budgetType ?? project?.budgetType ?? 'FIXED');

  return (
    <form action={action} className="space-y-6" noValidate data-testid="project-form">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {project ? <input type="hidden" name="id" value={project.id} /> : null}

      <Field label="Titel" hint="Was soll erledigt werden? z. B. „Website für unseren Verein umziehen“" error={errors.title} required>
        <Input name="title" maxLength={120} defaultValue={v?.title ?? project?.title} />
      </Field>
      <Field
        label="Beschreibung"
        hint="Umfang, gewünschtes Ergebnis, was schon vorhanden ist (50–5000 Zeichen). Bitte keine Telefonnummern oder E-Mail-Adressen – Antworten kommen über die Nachrichten."
        error={errors.description}
        required
      >
        <Textarea name="description" rows={8} maxLength={5000} defaultValue={v?.description ?? project?.description} />
      </Field>
      <Field label="Kategorie" error={errors.categorySlug} required>
        <Select name="categorySlug" defaultValue={v?.categorySlug ?? project?.category.slug ?? ''}>
          <option value="">Bitte wählen</option>
          {SERVICE_CATEGORY_GROUPS.map((group) => (
            <optgroup key={group.slug} label={group.name}>
              {group.categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink-900">Wo?</legend>
        <div className="space-y-1.5">
          <Label htmlFor="f-ort">PLZ und Ort</Label>
          <LocationInput initial={project?.location ?? null} />
          {errors.locationId ? <p className="text-sm font-medium text-danger-600">{errors.locationId[0]}</p> : null}
        </div>
        <Checkbox name="remote" defaultChecked={v ? v.remote === 'on' : Boolean(project?.remote)} label="Kann auch remote (online) erledigt werden" />
        <p className="text-xs text-ink-500">Öffentlich erscheinen nur PLZ und Ort, keine Adresse.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget" error={errors.budgetType} required>
          <Select name="budgetType" value={budgetType} onChange={(e) => setBudgetType(e.target.value as typeof budgetType)}>
            {PROJECT_BUDGET_TYPES.map((type) => (
              <option key={type} value={type}>{PROJECT_BUDGET_TYPE_LABELS[type]}</option>
            ))}
          </Select>
        </Field>
        {budgetType !== 'OPEN' ? (
          <Field label={budgetType === 'HOURLY' ? 'Höchstens € pro Stunde' : 'Betrag in €'} hint="Bruttobetrag, z. B. 800" error={errors.budget} required>
            <Input name="budget" inputMode="decimal" maxLength={12} defaultValue={v?.budget ?? centsToInput(project?.budgetCents)} />
          </Field>
        ) : null}
      </div>
      <Field label="Zeitraum" hint="optional, z. B. „bis Ende März“ oder „ab sofort, ca. 2 Wochen“" error={errors.timeframe}>
        <Input name="timeframe" maxLength={160} defaultValue={v?.timeframe ?? project?.timeframe ?? ''} />
      </Field>

      <SubmitButton>{project ? 'Änderungen speichern' : 'Als Entwurf speichern'}</SubmitButton>
    </form>
  );
}

/** Welche Statuswechsel im jeweiligen Status möglich sind (die API prüft dasselbe) */
function opsFor(project: MyServiceProject) {
  const ops: ('pause' | 'resume' | 'close' | 'extend' | 'resubmit')[] = [];
  if (project.status === 'ACTIVE') ops.push('pause');
  if (project.status === 'PAUSED') ops.push('resume');
  if (project.status === 'ACTIVE' || project.status === 'PAUSED') {
    const left = project.expiresAt ? new Date(project.expiresAt).getTime() - Date.now() : 0;
    if (left <= PROJECT_EXTEND_WINDOW_DAYS * DAY_MS) ops.push('extend');
    ops.push('close');
  }
  if (project.status === 'REJECTED') ops.push('resubmit');
  return ops;
}

const OP_LABELS = {
  pause: 'Pausieren',
  resume: 'Wieder sichtbar schalten',
  close: 'Beenden (jemand gefunden)',
  extend: `Um ${PROJECT_RUN_DAYS} Tage verlängern`,
  resubmit: 'Erneut prüfen lassen',
} as const;

export function ProjectStatusActions({ project }: { project: MyServiceProject }) {
  const [state, action] = useActionState(projectOpAction, initialFormState);
  const ops = opsFor(project);
  return (
    <div className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {project.status === 'DRAFT' ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={project.id} />
          <Checkbox
            name="confirmed"
            label="Ich bestätige: Es geht um eine selbstständige Leistung für ein konkretes Vorhaben, nicht um eine Anstellung. Die Angaben stimmen, und ich suche die Leistung tatsächlich."
          />
          <SubmitButton name="op" value="publish" size="sm">
            Für {PROJECT_RUN_DAYS} Tage veröffentlichen
          </SubmitButton>
        </form>
      ) : ops.length ? (
        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={project.id} />
          {ops.map((op) => (
            <SubmitButton key={op} name="op" value={op} size="sm" variant={op === 'close' ? 'ghost' : 'outline'}>
              {OP_LABELS[op]}
            </SubmitButton>
          ))}
        </form>
      ) : null}
    </div>
  );
}

/** Auftrag löschen: verschwindet sofort; bestehende Unterhaltungen bleiben für beide Seiten lesbar. */
export function DeleteProjectForm({ id }: { id: string }) {
  const [state, action] = useActionState(projectOpAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <Checkbox name="confirmed" label="Ja, ich möchte diesen Auftrag löschen." />
      <SubmitButton name="op" value="delete" size="sm" variant="ghost" className="text-danger-600">
        Auftrag löschen
      </SubmitButton>
    </form>
  );
}
