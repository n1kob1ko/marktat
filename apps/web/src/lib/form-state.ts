/** Einheitlicher Rückgabewert von Server Actions für Formulare (useActionState). */
export interface FormState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Eingaben zurückgeben, damit das Formular nach einem Fehler nicht leer ist (nie Passwörter!) */
  values?: Record<string, string>;
}

export const initialFormState: FormState = { status: 'idle' };

export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_form';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
