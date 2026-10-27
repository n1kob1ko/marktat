/**
 * Stellt eine Sicherung in eine NEUE, eigene Datenbank wieder her – nie in die Entwicklungs- oder Testdatenbanken.
 *
 *   pnpm --filter @marktat/api db:restore -- --file backups/marktat-2026-10-27T15-00-00.dump --target marktat_restore
 *
 * Gibt es die Zieldatenbank schon, bricht das Skript ab (kein Überschreiben). Zum Prüfen danach z. B.
 *   DATABASE_URL=postgresql://…/marktat_restore pnpm --filter @marktat/api start
 * Eine echte Wiederherstellung der Entwicklungsdatenbank ist bewusst ein manueller Schritt (docs/betrieb.md).
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DB_NAME, databaseExists, inDb, PG_USER, PROTECTED_DATABASES, sql } from './lib/pg-docker.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { file: { type: 'string' }, target: { type: 'string' } },
});

export async function restore(file: string, target: string) {
  if (!existsSync(file)) throw new Error(`Datei ${file} nicht gefunden.`);
  if (!DB_NAME.test(target)) throw new Error('Ungültiger Datenbankname (nur a–z, 0–9 und _).');
  if (PROTECTED_DATABASES.includes(target)) throw new Error(`${target} ist eine Datenbank der Entwicklungsumgebung und wird nie überschrieben.`);
  if (await databaseExists(target)) throw new Error(`Die Datenbank ${target} gibt es schon – bitte einen neuen Namen wählen.`);
  await sql('postgres', `CREATE DATABASE ${target}`);
  // Erweiterungen wie im Init-Skript, damit Spalten mit PostGIS-/Trigramm-Typen wiederhergestellt werden können
  await sql(target, 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  await inDb(['pg_restore', '-U', PG_USER, '-d', target, '--no-owner', '--no-privileges', '--exit-on-error'], { stdinFile: file });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!values.file || !values.target) {
    console.error('Aufruf: db:restore -- --file <sicherung.dump> --target <neue_datenbank>');
    process.exitCode = 2;
  } else {
    await restore(values.file, values.target);
    console.log(`Wiederhergestellt in ${values.target}.`);
  }
}
