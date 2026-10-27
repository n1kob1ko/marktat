'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { initialFormState } from '@/lib/form-state';
import { confirmEnrollAction, removeFactorAction, startEnrollAction } from './actions';

/** Schlüssel in Vierergruppen – leichter abzutippen, falls der QR-Code nicht gescannt werden kann */
function groups(secret: string) {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function EnrollForm() {
  const [started, start] = useActionState(startEnrollAction, initialFormState);
  const [confirmed, confirm] = useActionState(confirmEnrollAction, initialFormState);
  // Nach einem falschen Code bleibt die Einrichtung offen (Werte kommen aus der Bestätigung zurück)
  const pending = confirmed.values?.factorId ? confirmed.values : started.status === 'success' ? started.values : undefined;

  if (!pending?.factorId) {
    return (
      <form action={start} className="space-y-4" noValidate>
        {started.message ? <Alert tone="danger">{started.message}</Alert> : null}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
          <li>Authenticator-App auf dem Handy installieren.</li>
          <li>Gerät benennen und auf „Weiter“ tippen.</li>
          <li>QR-Code scannen und den angezeigten Code eingeben.</li>
        </ol>
        <Field label="Name des Geräts" hint="Nur für dich, z. B. „Handy“ oder „Tablet“." error={started.fieldErrors?.name} required>
          <Input name="name" maxLength={40} defaultValue={started.values?.name ?? 'Handy'} autoComplete="off" />
        </Field>
        <SubmitButton>Weiter</SubmitButton>
      </form>
    );
  }

  return (
    <form action={confirm} className="space-y-4" noValidate>
      <input type="hidden" name="factorId" value={pending.factorId} />
      <input type="hidden" name="qrCode" value={pending.qrCode} />
      <input type="hidden" name="secret" value={pending.secret} />
      <input type="hidden" name="name" value={pending.name} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* QR-Code kommt als SVG-Daten-URL direkt von Supabase Auth */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pending.qrCode} alt="QR-Code zum Einrichten in der Authenticator-App" width={176} height={176} className="size-44 shrink-0 rounded-lg border border-line bg-white p-2" />
        <div className="space-y-2 text-sm text-ink-700">
          <p>Scanne den QR-Code mit deiner Authenticator-App. Ohne Kamera: Schlüssel manuell eingeben (zeitbasiert, 6 Ziffern).</p>
          <p className="font-mono text-base break-all text-ink-900" aria-label="Schlüssel zum manuellen Eingeben">
            {groups(pending.secret ?? '')}
          </p>
          <p className="text-ink-500">Gib den Schlüssel niemandem weiter. Er wird nach der Einrichtung nicht mehr angezeigt.</p>
        </div>
      </div>
      <Field label="Code aus der App" hint="Erst wenn der Code stimmt, ist die Zwei-Faktor-Anmeldung aktiv." error={confirmed.fieldErrors?.code} required>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} className="max-w-48 font-mono text-lg tracking-widest" autoFocus />
      </Field>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>Bestätigen und aktivieren</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

export function RemoveFactorForm({ factorId, name, disabled }: { factorId: string; name: string; disabled: boolean }) {
  const [state, action] = useActionState(removeFactorAction, initialFormState);
  return (
    <form
      action={action}
      className="flex flex-col items-end gap-2"
      onSubmit={(event) => {
        if (!window.confirm(`„${name}“ entfernen? Danach kannst du dich mit diesem Gerät nicht mehr anmelden.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="factorId" value={factorId} />
      <SubmitButton variant="outline" size="sm" disabled={disabled}>
        Entfernen
      </SubmitButton>
      {disabled ? <p className="text-xs text-ink-500">Erst nach Anmeldung mit Code möglich.</p> : null}
      {state.message ? <p className="max-w-xs text-right text-sm font-medium text-danger-600">{state.message}</p> : null}
    </form>
  );
}
