import type { SavedSearchKind } from '@marktat/shared';

/** Kurztext zur E-Mail-Benachrichtigung je Art (Deals und Anbieter als tägliche Sammelmail) */
export const SAVED_SEARCH_NOTIFY_TEXT: Record<SavedSearchKind, string> = {
  LISTINGS: 'E-Mail bei neuen Anzeigen',
  DEALS: 'höchstens eine E-Mail am Tag mit neuen Deals',
  SERVICES: 'höchstens eine E-Mail am Tag mit neuen Anbietern',
};

/** Häkchen im Dialog „Suche speichern“ */
export const SAVED_SEARCH_NOTIFY_LABEL: Record<SavedSearchKind, string> = {
  LISTINGS: 'Per E-Mail benachrichtigen, wenn neue passende Anzeigen erscheinen',
  DEALS: 'Neue passende Deals per E-Mail schicken (gesammelt, höchstens einmal am Tag)',
  SERVICES: 'Neue passende Anbieter per E-Mail schicken (gesammelt, höchstens einmal am Tag)',
};

export const SAVED_SEARCH_SUCCESS: Record<SavedSearchKind, string> = {
  LISTINGS: 'Gespeichert. Wir schicken dir eine E-Mail, sobald neue passende Anzeigen erscheinen.',
  DEALS: 'Gespeichert. Neue passende Deals bekommst du gesammelt, höchstens einmal am Tag, per E-Mail.',
  SERVICES: 'Gespeichert. Neue passende Anbieter bekommst du gesammelt, höchstens einmal am Tag, per E-Mail.',
};
