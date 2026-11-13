import { describe, expect, it } from 'vitest';
import { COMMANDS, filterCommands } from './commands';

const ids = (query: string) => filterCommands(query).map((command) => command.id);

describe('filterCommands', () => {
  it('zeigt ohne Eingabe die Wege und Bereiche, aber keine Einstellungen', () => {
    const all = filterCommands('');
    expect(all.length).toBeGreaterThan(8);
    expect(all.every((command) => command.group !== 'Darstellung')).toBe(true);
    expect(filterCommands('   ')).toEqual(all);
  });

  it('findet Einträge am Wortanfang von Beschriftung und Stichwörtern', () => {
    expect(ids('mer')).toEqual(['merkliste']);
    expect(ids('favoriten')).toEqual(['merkliste']);
    expect(ids('dunkel')).toEqual(['theme']);
    expect(ids('motor')).toContain('auto-motor');
    // mitten im Wort zählt nicht
    expect(ids('liste')).toEqual([]);
  });

  it('nimmt Groß-/Kleinschreibung und Umlaute nicht genau', () => {
    expect(ids('MOBEL')).toEqual(['marktplatz']);
    expect(ids('Händler')).toEqual(ids('handler'));
  });

  it('verlangt bei mehreren Wörtern jedes davon', () => {
    expect(ids('meine anz')).toEqual(['anzeigen']);
    expect(ids('meine xyz')).toEqual([]);
  });

  it('hat eindeutige Kennungen und für jeden Eintrag ein Ziel oder eine Aktion', () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
    expect(COMMANDS.every((command) => Boolean(command.href) !== Boolean(command.action))).toBe(true);
  });
});
