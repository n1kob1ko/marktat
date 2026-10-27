import { Field, Input } from '@marktat/ui';

/**
 * Bestätigungscode für kritische Admin-Aktionen. Nur sichtbar, wenn die Sitzung mit 2FA bestätigt ist – dann
 * verlangt die API einen Code, der höchstens `maxAgeMinutes` alt ist. Innerhalb dieser Zeit darf das Feld leer bleiben.
 */
export function StepUpField({ enabled, error, maxAgeMinutes }: { enabled: boolean; error?: string[]; maxAgeMinutes?: number }) {
  if (!enabled) return null;
  return (
    <Field
      label="Bestätigungscode (Authenticator-App)"
      hint={`Kritische Aktion: Gib den aktuellen 6-stelligen Code ein. Nicht nötig, wenn du in den letzten ${maxAgeMinutes ?? 10} Minuten einen Code eingegeben hast.`}
      error={error}
    >
      <Input name="mfaCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} className="max-w-48 font-mono tracking-widest" />
    </Field>
  );
}
