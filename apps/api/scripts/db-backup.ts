/**
 * Sicherung der lokalen Datenbanken (App und Supabase Auth) als pg_dump-Dateien im Custom-Format.
 *
 *   pnpm --filter @marktat/api db:backup                       → backups/<db>-<zeit>.dump für marktat und marktat_auth
 *   pnpm --filter @marktat/api db:backup -- --db marktat       → nur eine Datenbank
 *
 * Liest nur (pg_dump verändert nichts). Die Dateien enthalten personenbezogene Daten:
 * nie committen (backups/ steht in .gitignore), verschlüsselt und getrennt vom Server aufbewahren.
 * Bilder liegen nicht in der Datenbank (R2 bzw. apps/api/.storage) – siehe docs/betrieb.md.
 */
import { mkdirSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DB_NAME, databaseExists, inDb, PG_USER, REPO_ROOT, timestamp } from './lib/pg-docker.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { db: { type: 'string', multiple: true }, out: { type: 'string' } },
});
const databases = values.db?.length ? values.db : ['marktat', 'marktat_auth'];
const dir = values.out ?? `${REPO_ROOT}backups`;
mkdirSync(dir, { recursive: true });

for (const db of databases) {
  if (!DB_NAME.test(db) || !(await databaseExists(db))) {
    console.error(`Datenbank ${db} gibt es nicht.`);
    process.exitCode = 1;
    continue;
  }
  const file = `${dir}/${db}-${timestamp()}.dump`;
  await inDb(['pg_dump', '-U', PG_USER, '-d', db, '-Fc', '--no-owner', '--no-privileges'], { stdoutFile: file });
  // pg_dump-Dateien im Custom-Format beginnen mit „PGDMP“; leere Dateien wären eine stille Fehlsicherung
  const size = statSync(file).size;
  if (size < 100) throw new Error(`Sicherung ${file} ist unvollständig (${size} Bytes).`);
  console.log(`${db} → ${file} (${(size / 1024).toFixed(0)} KB)`);
}
