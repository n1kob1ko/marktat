'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Input, Label } from '@marktat/ui';
import type { DealStoreView } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { LocationInput } from '@/components/search/location-input';
import { SubmitButton } from '@/components/submit-button';
import { certifyDealerAction, deleteStoreAction, extendDealAction, saveStoreAction } from './actions';

/** Bestätigung nach Art. 30 DSA (Nachverfolgbarkeit gewerblicher Anbieter) – einmalig vor dem ersten Deal */
export function CertifyDealerForm() {
  const [state, action] = useActionState(certifyDealerAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Checkbox
        name="confirmed"
        label="Ich bestätige, dass meine Firmenangaben (Name, Geschäftsadresse, Telefonnummer) stimmen, dass ich gewerblich anbiete und nur Angebote einstelle, die ich selbst anbiete und deren Preise ich belegen kann."
      />
      <SubmitButton size="sm">Bestätigen</SubmitButton>
    </form>
  );
}

export function ExtendDealForm({ id, endsOn, maxEndsOn }: { id: string; endsOn: string; maxEndsOn: string }) {
  const [state, action] = useActionState(extendDealAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <Field label="Neues Enddatum" hint={`Höchstens bis ${maxEndsOn.split('-').reverse().join('.')}`} error={state.fieldErrors?.endsOn}>
        <Input name="endsOn" type="date" min={endsOn} max={maxEndsOn} defaultValue={state.values?.endsOn ?? endsOn} />
      </Field>
      <SubmitButton size="sm" variant="outline">Verlängern</SubmitButton>
    </form>
  );
}

/** Filiale anlegen oder bearbeiten (immer nur ein Formular je Seite, der Ort kommt aus der PLZ-Suche) */
export function StoreForm({ store }: { store?: DealStoreView }) {
  const [state, action] = useActionState(saveStoreAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {store ? <input type="hidden" name="id" value={store.id} /> : null}
      <Field label="Name der Filiale" hint="z. B. „Filiale Graz-Lend“" error={errors.name} required>
        <Input name="name" maxLength={120} defaultValue={v?.name ?? store?.name} />
      </Field>
      <Field label="Straße und Hausnummer" error={errors.street} required>
        <Input name="street" maxLength={200} autoComplete="street-address" defaultValue={v?.street ?? store?.street} />
      </Field>
      <div className="space-y-1.5">
        <Label htmlFor="f-ort">
          PLZ und Ort<span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>
        </Label>
        <LocationInput initial={store?.location ?? null} />
        {errors.locationId ? <p className="text-sm font-medium text-danger-600">{errors.locationId[0]}</p> : null}
      </div>
      <Field label="Öffnungszeiten" hint="optional, z. B. „Mo–Fr 9–18 Uhr, Sa 9–13 Uhr“" error={errors.openingHours}>
        <Input name="openingHours" maxLength={300} defaultValue={v?.openingHours ?? store?.openingHours ?? ''} />
      </Field>
      <SubmitButton>{store ? 'Filiale speichern' : 'Filiale anlegen'}</SubmitButton>
    </form>
  );
}

export function DeleteStoreButton({ id }: { id: string }) {
  const [state, action] = useActionState(deleteStoreAction, initialFormState);
  return (
    <form action={action}>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost" className="text-danger-600">Löschen</SubmitButton>
    </form>
  );
}
