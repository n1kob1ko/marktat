import { execSync } from 'node:child_process';
import { applyTestEnv } from './test-env.js';

export default function setup() {
  applyTestEnv();
  const options = { stdio: 'inherit' as const, env: process.env, cwd: new URL('..', import.meta.url) };
  execSync('pnpm exec prisma migrate deploy', options);
  execSync('pnpm exec tsx prisma/seed/seed.ts', options);
}
