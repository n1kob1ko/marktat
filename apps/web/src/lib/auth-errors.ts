/** Übersetzt Fehlercodes von Supabase Auth in verständliche deutsche Meldungen. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-Mail-Adresse oder Passwort ist falsch.',
  email_not_confirmed: 'Bitte bestätige zuerst deine E-Mail-Adresse. Wir haben dir einen Link geschickt.',
  user_already_exists: 'Mit dieser E-Mail-Adresse gibt es bereits ein Konto.',
  email_exists: 'Mit dieser E-Mail-Adresse gibt es bereits ein Konto.',
  weak_password: 'Das Passwort ist zu schwach. Bitte wähle ein längeres Passwort.',
  same_password: 'Das neue Passwort muss sich vom bisherigen unterscheiden.',
  over_email_send_rate_limit: 'Zu viele E-Mails in kurzer Zeit. Bitte warte einige Minuten.',
  over_request_rate_limit: 'Zu viele Versuche. Bitte warte kurz und versuche es erneut.',
  otp_expired: 'Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen an.',
  signup_disabled: 'Registrierungen sind derzeit deaktiviert.',
  user_banned: 'Dieses Konto ist gesperrt.',
  session_not_found: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
};

export function authErrorMessage(error: { code?: string; status?: number } | null | undefined): string {
  if (error?.code && MESSAGES[error.code]) return MESSAGES[error.code]!;
  if (error?.status === 429) return MESSAGES.over_request_rate_limit!;
  return 'Das hat leider nicht geklappt. Bitte versuche es später erneut.';
}
