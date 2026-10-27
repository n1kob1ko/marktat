import { Alert } from '@marktat/ui';

const MESSAGES: Record<string, { tone: 'success' | 'danger' | 'warning'; text: string }> = {
  veroeffentlicht: { tone: 'success', text: 'Deine Anzeige ist jetzt online.' },
  entwurf: { tone: 'success', text: 'Dein Entwurf wurde gespeichert.' },
  gespeichert: { tone: 'success', text: 'Deine Änderungen wurden gespeichert.' },
  pausiert: { tone: 'success', text: 'Die Anzeige ist pausiert und für andere nicht mehr sichtbar.' },
  fortgesetzt: { tone: 'success', text: 'Die Anzeige ist wieder online.' },
  geloescht: { tone: 'success', text: 'Die Anzeige wurde gelöscht.' },
  unvollstaendig: { tone: 'warning', text: 'Die Anzeige ist noch nicht vollständig. Bitte ergänze die fehlenden Angaben.' },
  blockiert: { tone: 'success', text: 'Die Person ist blockiert. Ihr könnt euch keine Nachrichten mehr schicken.' },
  entblockt: { tone: 'success', text: 'Die Blockierung ist aufgehoben.' },
  entfernt: { tone: 'success', text: 'Die Anzeige wurde von deiner Merkliste entfernt.' },
  umbenannt: { tone: 'success', text: 'Der Name der Suche wurde geändert.' },
  'alarm-an': { tone: 'success', text: 'Du bekommst ab jetzt eine E-Mail, sobald neue passende Anzeigen erscheinen.' },
  'alarm-aus': { tone: 'success', text: 'Die E-Mail-Benachrichtigung für diese Suche ist ausgeschaltet.' },
  'suche-geloescht': { tone: 'success', text: 'Die gespeicherte Suche wurde gelöscht.' },
  aktion: { tone: 'danger', text: 'Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.' },
};

/** Zeigt Rückmeldungen nach Weiterleitungen (?hinweis=… bzw. ?fehler=…). */
export function FlashMessage({ hinweis, fehler }: { hinweis?: string; fehler?: string }) {
  const entry = (fehler && MESSAGES[fehler]) || (hinweis && MESSAGES[hinweis]);
  if (!entry) return null;
  return <Alert tone={entry.tone}>{entry.text}</Alert>;
}
