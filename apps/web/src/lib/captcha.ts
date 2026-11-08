/** Prüfwert des Captchas aus dem Formular (leer, wenn kein Captcha konfiguriert ist) */
export function captchaToken(formData: FormData): string | undefined {
  const value = formData.get('cf-turnstile-response');
  return typeof value === 'string' && value ? value.slice(0, 4096) : undefined;
}
