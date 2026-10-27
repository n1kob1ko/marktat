/**
 * Hilfen für Sicherung und Wiederherstellung über den lokalen Datenbank-Container (pnpm infra:up).
 * pg_dump/pg_restore laufen im Container – lokal müssen keine PostgreSQL-Werkzeuge installiert sein.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const rootEnv = `${REPO_ROOT}.env`;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const PG_USER = process.env.POSTGRES_USER ?? 'marktat';

/** Datenbanken der Entwicklungsumgebung, die Wiederherstellungen nie überschreiben dürfen */
export const PROTECTED_DATABASES = ['marktat', 'marktat_auth', 'marktat_test', 'marktat_shadow', 'postgres', 'template0', 'template1'];

export const DB_NAME = /^[a-z][a-z0-9_]{0,62}$/;

const compose = ['compose', '-f', `${REPO_ROOT}infra/docker-compose.yml`, '--env-file', rootEnv, 'exec', '-T', 'db'];

/** Befehl im Datenbank-Container; stdin/stdout optional aus/in Dateien */
export function inDb(args: string[], io: { stdinFile?: string; stdoutFile?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...compose, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    if (io.stdoutFile) child.stdout.pipe(createWriteStream(io.stdoutFile));
    else child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    if (io.stdinFile) createReadStream(io.stdinFile).pipe(child.stdin);
    else child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${args[0]} fehlgeschlagen (${code}): ${err.trim()}`))));
  });
}

export function sql(database: string, statement: string): Promise<string> {
  return inDb(['psql', '-U', PG_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement]);
}

export async function databaseExists(name: string): Promise<boolean> {
  return (await sql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${name}'`)).trim() === '1';
}

export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
