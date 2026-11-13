/**
 * Einträge des Schnellmenüs (Strg+K). Bewusst wenige: die Wege, die am häufigsten gebraucht werden,
 * in zwei Gruppen. Der Rest der Seite ist über die Suche im selben Feld erreichbar.
 */
export interface Command {
  id: string;
  label: string;
  group: 'Schnell hin' | 'Bereiche' | 'Darstellung';
  /** Ziel innerhalb der Seite – oder `action` für etwas, das auf der Stelle passiert */
  href?: string;
  action?: 'theme';
  /** Weitere Wörter, unter denen der Eintrag gefunden wird */
  keywords?: string[];
}

export const COMMANDS: Command[] = [
  { id: 'inserieren', label: 'Inserat aufgeben', group: 'Schnell hin', href: '/inserieren', keywords: ['verkaufen', 'anzeige', 'neu', 'einstellen'] },
  { id: 'nachrichten', label: 'Nachrichten', group: 'Schnell hin', href: '/nachrichten', keywords: ['postfach', 'chat', 'anfragen'] },
  { id: 'merkliste', label: 'Merkliste', group: 'Schnell hin', href: '/konto/merkliste', keywords: ['favoriten', 'gemerkt', 'herz'] },
  { id: 'anzeigen', label: 'Meine Anzeigen', group: 'Schnell hin', href: '/konto/anzeigen', keywords: ['inserate', 'verwalten'] },
  { id: 'suchen', label: 'Gespeicherte Suchen', group: 'Schnell hin', href: '/konto/suchen', keywords: ['suchagent', 'benachrichtigung', 'alarm'] },
  { id: 'konto', label: 'Mein Konto', group: 'Schnell hin', href: '/konto', keywords: ['profil', 'einstellungen', 'anmelden'] },
  { id: 'marktplatz', label: 'Marktplatz', group: 'Bereiche', href: '/suche?bereich=marktplatz', keywords: ['möbel', 'mode', 'elektronik'] },
  { id: 'auto-motor', label: 'Auto & Motor', group: 'Bereiche', href: '/suche?bereich=auto-motor', keywords: ['fahrzeuge', 'motorrad', 'gebrauchtwagen'] },
  { id: 'immobilien', label: 'Immobilien', group: 'Bereiche', href: '/suche?bereich=immobilien', keywords: ['wohnung', 'haus', 'miete'] },
  { id: 'jobs', label: 'Jobs', group: 'Bereiche', href: '/suche?bereich=jobs', keywords: ['stellen', 'arbeit'] },
  { id: 'deals', label: 'Deals', group: 'Bereiche', href: '/deals', keywords: ['angebote', 'rabatt', 'händler'] },
  { id: 'dienstleistungen', label: 'Dienstleistungen', group: 'Bereiche', href: '/dienstleistungen', keywords: ['handwerk', 'nachhilfe', 'freelancer'] },
  { id: 'theme', label: 'Hell/Dunkel umschalten', group: 'Darstellung', action: 'theme', keywords: ['dunkelmodus', 'dark', 'nacht', 'design'] },
];

function normalize(text: string): string {
  return text.toLocaleLowerCase('de-AT').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').trim();
}

/**
 * Filtert die Einträge nach der Eingabe: jedes eingegebene Wort muss am Anfang eines Worts der Beschriftung
 * oder eines Stichworts stehen („mer“ findet „Merkliste“, „dunkel“ findet „Hell/Dunkel umschalten“).
 * Ohne Eingabe: alles außer der Darstellung.
 */
export function filterCommands(query: string, commands: readonly Command[] = COMMANDS): Command[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return commands.filter((command) => command.group !== 'Darstellung');
  return commands.filter((command) => {
    const haystack = [command.label, ...(command.keywords ?? [])].flatMap((text) => normalize(text).split(/[\s/&-]+/)).filter(Boolean);
    return words.every((word) => haystack.some((candidate) => candidate.startsWith(word)));
  });
}
