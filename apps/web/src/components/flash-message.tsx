import { Alert } from '@marktat/ui';

const MESSAGES: Record<string, { tone: 'success' | 'danger' | 'warning'; text: string }> = {
  veroeffentlicht: { tone: 'success', text: 'Deine Anzeige ist jetzt online.' },
  '2fa-aktiv': { tone: 'success', text: 'Die Zwei-Faktor-Anmeldung ist aktiv. Ab der nächsten Anmeldung fragen wir nach dem Code.' },
  '2fa-entfernt': { tone: 'success', text: 'Das Gerät wurde entfernt.' },
  '2fa-zurueckgesetzt': { tone: 'success', text: 'Die Zwei-Faktor-Anmeldung ist zurückgesetzt. Die Person meldet sich mit Passwort an und richtet sie neu ein.' },
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
  eingereicht: { tone: 'success', text: 'Danke! Die Anzeige wird erneut geprüft. Wir melden uns, sobald sie wieder online ist.' },
  'nicht-ueberarbeitet': { tone: 'warning', text: 'Bitte überarbeite die Anzeige zuerst. Danach kannst du sie erneut zur Prüfung einreichen.' },
  gemeldet: { tone: 'success', text: 'Danke für deine Meldung. Ein Mensch aus unserem Team prüft sie – das Ergebnis findest du unter „Mitteilungen“ in deinem Konto.' },
  'einspruch-eingereicht': { tone: 'success', text: 'Dein Einspruch ist eingegangen. Jemand aus dem Team prüft die Entscheidung erneut.' },
  'mod-entschieden': { tone: 'success', text: 'Die Entscheidung ist gespeichert. Das Inserat ist nicht mehr öffentlich, die betroffene Person wurde mit Begründung informiert.' },
  'mod-freigegeben': { tone: 'success', text: 'Das Inserat ist freigegeben. Die Anbieterin bzw. der Anbieter wurde informiert.' },
  'mod-gesperrt': { tone: 'success', text: 'Das Konto ist gesperrt. Die Person wurde mit Begründung informiert.' },
  'mod-entsperrt': { tone: 'success', text: 'Die Sperre ist aufgehoben. Die Person wurde informiert.' },
  'mod-einspruch': { tone: 'success', text: 'Der Einspruch ist entschieden. Die Person wurde informiert.' },
  'mod-geschlossen': { tone: 'success', text: 'Die Meldung ist ohne Maßnahme abgeschlossen. Die meldende Person wurde informiert.' },
  'gebucht-highlight': { tone: 'success', text: 'Deine Anzeige ist jetzt hervorgehoben.' },
  'gebucht-top': { tone: 'success', text: 'Deine Anzeige ist jetzt eine Top-Anzeige und erscheint abwechselnd über passenden Suchergebnissen.' },
  'gebucht-bump': { tone: 'success', text: 'Deine Anzeige wurde hochgeschoben und steht bei „Neueste“ wieder weit oben.' },
  'gebucht-listing': { tone: 'success', text: 'Deine Anzeige ist jetzt online.' },
  'nicht-buchbar': { tone: 'warning', text: 'Diese Leistung ist für die Anzeige gerade nicht möglich. Den Grund siehst du bei der jeweiligen Leistung.' },
  'zu-viele-buchungen': { tone: 'warning', text: 'Zu viele Buchungen in kurzer Zeit. Bitte versuche es später noch einmal.' },
  'zahlung-nicht-moeglich': { tone: 'danger', text: 'Die Zahlung konnte gerade nicht gestartet werden. Es wurde nichts verrechnet.' },
  zahlpflichtig: { tone: 'warning', text: 'Das Veröffentlichen ist derzeit kostenpflichtig. Du kannst es hier buchen – deine Anzeige bleibt bis dahin ein Entwurf.' },
  aktion: { tone: 'danger', text: 'Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.' },
};

/** Zeigt Rückmeldungen nach Weiterleitungen (?hinweis=… bzw. ?fehler=…). */
export function FlashMessage({ hinweis, fehler }: { hinweis?: string; fehler?: string }) {
  const entry = (fehler && MESSAGES[fehler]) || (hinweis && MESSAGES[hinweis]);
  if (!entry) return null;
  return <Alert tone={entry.tone}>{entry.text}</Alert>;
}
