import { createHmac } from 'node:crypto';
import { envSchema } from './env.js';
import { checkProductionEnv } from './production-check.js';

const JWT_SECRET = 'a'.repeat(64);
function key(role: string, secret = JWT_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}

const raw = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://marktat:0123456789abcdef@db:5432/marktat',
  REDIS_URL: 'redis://:0123456789abcdef@redis:6379',
  SUPABASE_URL: 'https://api.marktat.example',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  SUPABASE_ANON_KEY: key('anon'),
  SUPABASE_SERVICE_ROLE_KEY: key('service_role'),
  APP_SIGNING_SECRET: 'b'.repeat(64),
  WEB_URL: 'https://marktat.example',
  TRUST_PROXY: '1',
  SMTP_HOST: 'smtp.tem.scaleway.com',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'pass',
  MAIL_FROM: 'MarktAT <noreply@marktat.example>',
  MAIL_FROM_ADDRESS: 'noreply@marktat.example',
  MEILI_URL: 'http://meilisearch:7700',
  MEILI_MASTER_KEY: 'c'.repeat(48),
  R2_ACCOUNT_ID: 'd'.repeat(32),
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'marktat-prod',
  STAFF_MFA_REQUIRED: 'true',
  BACKUP_PASSPHRASE: 'e'.repeat(64),
};

const check = (overrides: Record<string, string | undefined> = {}) => {
  const input = { ...raw, ...overrides };
  return checkProductionEnv(envSchema.parse(input), input);
};

describe('Prüfung vor dem Online-Deployment', () => {
  it('akzeptiert eine vollständige Konfiguration ohne Hinweise', () => {
    expect(check()).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['Entwicklungspasswort', { DATABASE_URL: 'postgresql://marktat:marktat_dev_pw@db:5432/marktat' }, 'DATABASE_URL'],
    ['Dev-JWT-Secret', { SUPABASE_JWT_SECRET: 'marktat-local-dev-jwt-secret-change-me-0123456789' }, 'SUPABASE_JWT_SECRET'],
    ['fremd signierter Anon-Key', { SUPABASE_ANON_KEY: key('anon', 'x'.repeat(64)) }, 'SUPABASE_ANON_KEY'],
    ['vertauschte Rollen', { SUPABASE_SERVICE_ROLE_KEY: key('anon') }, 'SUPABASE_SERVICE_ROLE_KEY'],
    ['Entwicklungs-Bucket', { R2_BUCKET: 'marktat-dev' }, 'R2_BUCKET'],
    ['Backup im Bilder-Bucket', { BACKUP_R2_BUCKET: 'marktat-prod' }, 'BACKUP_R2_BUCKET'],
    ['Redis ohne Passwort', { REDIS_URL: 'redis://redis:6379' }, 'REDIS_URL'],
    ['2FA aus', { STAFF_MFA_REQUIRED: 'false' }, 'STAFF_MFA_REQUIRED'],
    ['Stripe live', { STRIPE_LIVE_ENABLED: 'true' }, 'STRIPE_LIVE_ENABLED'],
    ['Live-Schlüssel', { STRIPE_SECRET_KEY: 'sk_live_123' }, 'STRIPE_SECRET_KEY'],
    ['Beispiel-Absender', { MAIL_FROM: 'MarktAT <noreply@example.at>', MAIL_FROM_ADDRESS: 'noreply@example.at' }, 'MAIL_FROM'],
    ['fehlende Backup-Passphrase', { BACKUP_PASSPHRASE: undefined }, 'BACKUP_PASSPHRASE'],
  ])('lehnt ab: %s', (_label, overrides, name) => {
    const { errors } = check(overrides);
    expect(errors.some((error) => error.startsWith(name))).toBe(true);
  });

  it('gibt keine Werte aus', () => {
    const { errors } = check({ DATABASE_URL: 'postgresql://marktat:marktat_dev_pw@db:5432/marktat', R2_BUCKET: 'marktat-dev' });
    expect(errors.join(' ')).not.toContain('marktat_dev_pw');
  });

  it('warnt bei abweichender Absenderadresse, ohne abzubrechen', () => {
    expect(check({ MAIL_FROM_ADDRESS: 'auth@marktat.example' })).toMatchObject({ errors: [], warnings: [expect.stringContaining('MAIL_FROM')] });
  });
});
