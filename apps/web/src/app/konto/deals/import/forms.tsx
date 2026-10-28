'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Input, Select, Textarea } from '@marktat/ui';
import {
  DEAL_FEED_FORMAT_LABELS,
  DEAL_FEED_FORMATS,
  DEAL_FEED_MAX_INTERVAL_HOURS,
  DEAL_FEED_MIN_INTERVAL_HOURS,
  DEAL_IMPORT_FIELD_KEYS,
  DEAL_IMPORT_FIELDS,
  type DealFeedView,
  type DealImportMapping,
} from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { cancelImportAction, commitImportAction, feedOpAction, saveFeedAction, saveMappingAction } from './actions';

/** Je Feld eine Spalte der Datei wählen; Pflichtfelder zuerst */
export function MappingForm({ id, feedId, headers, mapping }: { id: string; feedId?: string | null; headers: string[]; mapping: DealImportMapping }) {
  const [state, action] = useActionState(saveMappingAction, initialFormState);
  const fields = [...DEAL_IMPORT_FIELD_KEYS].sort((a, b) => Number(DEAL_IMPORT_FIELDS[b].required) - Number(DEAL_IMPORT_FIELDS[a].required));
  return (
    <form action={action} className="space-y-4">
      {state.message ? <Alert tone={state.status === 'error' ? 'danger' : 'success'}>{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      {feedId ? <input type="hidden" name="feedId" value={feedId} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((key) => {
          const def = DEAL_IMPORT_FIELDS[key];
          return (
            <Field key={key} label={def.label} required={def.required}>
              <Select name={`map_${key}`} defaultValue={state.values?.[key] ?? mapping[key] ?? ''}>
                <option value="">{def.required ? 'Bitte Spalte wählen' : '– nicht verwenden –'}</option>
                {headers.map((header) => (
                  <option key={header} value={header}>{header}</option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
      <SubmitButton size="sm" variant="outline">{feedId ? 'Für den Feed speichern und erneut abrufen' : 'Zuordnung übernehmen'}</SubmitButton>
    </form>
  );
}

export function CommitImportForm({ id, hasReferencePrices, canPublish }: { id: string; hasReferencePrices: boolean; canPublish: boolean }) {
  const [state, action] = useActionState(commitImportAction, initialFormState);
  const mode = state.values?.mode ?? (canPublish ? 'publish' : 'draft');
  return (
    <form action={action} className="space-y-4">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink-900">Neue Angebote</legend>
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input type="radio" name="mode" value="publish" defaultChecked={mode === 'publish'} disabled={!canPublish} className="mt-1" />
          <span>Gleich veröffentlichen{canPublish ? '' : ' (erst nach vollständigem Profil und Bestätigung möglich)'}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input type="radio" name="mode" value="draft" defaultChecked={mode === 'draft'} className="mt-1" />
          <span>Als Entwurf speichern</span>
        </label>
        <p className="text-xs text-ink-500">Bestehende Angebote behalten ihren Status. Änderungen an Preis oder Vergleichspreis freigegebener Angebote werden erneut geprüft.</p>
      </fieldset>
      {hasReferencePrices ? (
        <>
          <input type="hidden" name="needsConfirmation" value="1" />
          <Checkbox
            name="confirmReferencePrices"
            label="Ich bestätige: Jeder Vergleichspreis in der Datei ist belegbar – als unverbindliche Preisempfehlung mit Quelle oder als mein niedrigster Preis der letzten 30 Tage vor der Ermäßigung."
          />
          {state.fieldErrors?.confirmReferencePrices ? <p className="text-sm font-medium text-danger-600">{state.fieldErrors.confirmReferencePrices[0]}</p> : null}
        </>
      ) : null}
      <SubmitButton>Import übernehmen</SubmitButton>
    </form>
  );
}

export function CancelImportButton({ id }: { id: string }) {
  const [state, action] = useActionState(cancelImportAction, initialFormState);
  return (
    <form action={action}>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost">Vorschau verwerfen</SubmitButton>
    </form>
  );
}

export function FeedForm({ feed }: { feed?: DealFeedView }) {
  const [state, action] = useActionState(saveFeedAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {feed ? <input type="hidden" name="id" value={feed.id} /> : null}
      <Field label="Name" hint="z. B. „Webshop-Feed“" error={errors.name} required>
        <Input name="name" maxLength={80} defaultValue={v?.name ?? feed?.name} />
      </Field>
      <Field label="Adresse des Feeds" hint="https-Adresse deines eigenen Shops bzw. deines Feed-Dienstleisters" error={errors.url} required>
        <Input name="url" type="url" inputMode="url" maxLength={500} defaultValue={v?.url ?? feed?.url} placeholder="https://" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Format" error={errors.format} required>
          <Select name="format" defaultValue={v?.format ?? feed?.format ?? 'CSV'}>
            {DEAL_FEED_FORMATS.map((f) => (
              <option key={f} value={f}>{DEAL_FEED_FORMAT_LABELS[f]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Abruf alle … Stunden" hint={`${DEAL_FEED_MIN_INTERVAL_HOURS} bis ${DEAL_FEED_MAX_INTERVAL_HOURS}`} error={errors.intervalHours} required>
          <Input name="intervalHours" type="number" min={DEAL_FEED_MIN_INTERVAL_HOURS} max={DEAL_FEED_MAX_INTERVAL_HOURS} defaultValue={v?.intervalHours ?? feed?.intervalHours ?? 24} />
        </Field>
      </div>
      <Field label="Herkunft und Nutzungsrechte" hint="Woher stammen die Daten und Bilder, und unter welchen Bedingungen darfst du sie hier verwenden?" error={errors.licenseNote} required>
        <Textarea name="licenseNote" rows={3} maxLength={500} defaultValue={v?.licenseNote ?? feed?.licenseNote} />
      </Field>
      <Checkbox
        name="licenseConfirmed"
        label="Der Feed ist mein eigener oder ich darf die Daten ausdrücklich so verwenden. Er enthält keine Daten, die von anderen Plattformen ausgelesen wurden."
      />
      {errors.licenseConfirmed ? <p className="text-sm font-medium text-danger-600">{errors.licenseConfirmed[0]}</p> : null}
      <Checkbox
        name="referencePricesConfirmed"
        defaultChecked={feed?.referencePricesConfirmed}
        label="Vergleichspreise im Feed sind belegbar (UVP mit Quelle oder eigener niedrigster Preis der letzten 30 Tage). Ohne diese Bestätigung werden Zeilen mit Vergleichspreis nicht übernommen."
      />
      <SubmitButton>{feed ? 'Speichern' : 'Feed zur Prüfung einreichen'}</SubmitButton>
      {feed ? <p className="text-xs text-ink-500">Eine neue Adresse oder ein anderes Format braucht eine neue Freigabe.</p> : null}
    </form>
  );
}

const FEED_OP_LABELS = { preview: 'Probeabruf', pause: 'Pausieren', resume: 'Fortsetzen', delete: 'Entfernen' } as const;

export function FeedOpButton({ id, op }: { id: string; op: keyof typeof FEED_OP_LABELS }) {
  const [state, action] = useActionState(feedOpAction, initialFormState);
  return (
    <form action={action}>
      {state.status === 'error' && state.message ? <Alert tone="danger" className="mb-2">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton size="sm" variant={op === 'delete' ? 'ghost' : 'outline'} className={op === 'delete' ? 'text-danger-600' : undefined}>
        {FEED_OP_LABELS[op]}
      </SubmitButton>
    </form>
  );
}
