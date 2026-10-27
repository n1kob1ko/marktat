/**
 * Prüft die Umgebung für den Online-Betrieb, bevor deploy.sh etwas verändert. Gibt nur Namen aus, nie Werte.
 *
 *   docker compose run --rm --no-deps api pnpm env:check     (auf dem Server über ./deploy.sh check)
 *
 * Exit-Code 1 bei Fehlern; Warnungen brechen nicht ab.
 */
import { loadEnv } from '../src/config/env.js';
import { checkProductionEnv } from '../src/config/production-check.js';

let env;
try {
  env = loadEnv();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const { errors, warnings } = checkProductionEnv(env, process.env);
for (const warning of warnings) console.log(`  ! ${warning}`);
for (const error of errors) console.log(`  ✗ ${error}`);
if (errors.length) {
  console.log(`\n${errors.length} Fehler – Deployment abgebrochen. Vorlage: infra/production/env.production.example`);
  process.exit(1);
}
console.log(`  ✓ Umgebung in Ordnung${warnings.length ? ` (${warnings.length} Hinweise)` : ''}`);
