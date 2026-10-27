'use client';

import { useActionState } from 'react';
import { Alert, Checkbox, Field, Input, Textarea } from '@marktat/ui';
import type { MeResponse } from '@marktat/shared';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { updateProfileAction } from './actions';

export function ProfileForm({ user }: { user: MeResponse }) {
  const [state, action] = useActionState(updateProfileAction, initialFormState);
  const value = (field: keyof MeResponse) => state.values?.[field] ?? (user[field] as string | null) ?? '';
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message ? <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Anzeigename" error={errors.displayName} required>
          <Input name="displayName" defaultValue={value('displayName')} maxLength={50} />
        </Field>
        <Field
          label="Telefon (optional)"
          hint={user.accountType === 'BUSINESS' ? 'Öffentlich nur, wenn du es unten freigibst.' : 'Wird nicht öffentlich angezeigt.'}
          error={errors.phone}
        >
          <Input name="phone" type="tel" autoComplete="tel" defaultValue={value('phone')} />
        </Field>
      </div>
      <Field label="Über mich (optional)" error={errors.bio}>
        <Textarea name="bio" defaultValue={value('bio')} maxLength={500} rows={3} />
      </Field>
      {user.accountType === 'BUSINESS' ? (
        <fieldset className="space-y-5 rounded-xl border border-line p-4 sm:p-5">
          <legend className="px-1 text-sm font-semibold">Pflichtangaben für gewerbliche Anbieter</legend>
          <p className="text-sm text-ink-500">
            Diese Angaben werden bei deinen Anzeigen veröffentlicht (Anbieterkennzeichnung nach ECG/DSA).
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Firmenname" error={errors.companyName}>
              <Input name="companyName" defaultValue={value('companyName')} />
            </Field>
            <Field label="Firmenbuchnummer" hint="z. B. FN 123456a" error={errors.companyRegisterNumber}>
              <Input name="companyRegisterNumber" defaultValue={value('companyRegisterNumber')} />
            </Field>
            <Field label="UID-Nummer" hint="z. B. ATU12345678" error={errors.vatId}>
              <Input name="vatId" defaultValue={value('vatId')} />
            </Field>
            <Field label="Geschäftsanschrift" error={errors.companyAddress}>
              <Input name="companyAddress" autoComplete="street-address" defaultValue={value('companyAddress')} />
            </Field>
            <Field label="Website (optional)" hint="z. B. https://www.radhaus.at" error={errors.website}>
              <Input name="website" type="url" inputMode="url" autoComplete="url" defaultValue={value('website')} />
            </Field>
          </div>
          <Checkbox name="showPhone" defaultChecked={user.showPhone} label="Telefonnummer auf meinem Händlerprofil zeigen" />
        </fieldset>
      ) : null}
      <SubmitButton>Profil speichern</SubmitButton>
    </form>
  );
}
