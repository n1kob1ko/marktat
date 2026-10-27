import { envSchema } from './env.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://marktat:geheim@db:5432/marktat',
  SUPABASE_URL: 'https://api.marktat.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  APP_SIGNING_SECRET: 'x'.repeat(40),
  WEB_URL: 'https://marktat.example',
  SMTP_HOST: 'smtp.example.eu',
  MAIL_FROM: 'MarktAT <noreply@marktat.example>',
  MEILI_URL: 'http://meilisearch:7700',
  MEILI_MASTER_KEY: 'k'.repeat(32),
};

const issues = (env: Record<string, string | undefined>) => {
  const result = envSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('Umgebung in Produktion', () => {
  it('akzeptiert eine vollständige Produktionskonfiguration', () => {
    expect(issues(production)).toEqual([]);
  });

  it.each([
    ['SMTP_HOST', { SMTP_HOST: undefined }],
    ['MAIL_FROM', { MAIL_FROM: 'MarktAT <noreply@marktat.local>' }],
    ['WEB_URL', { WEB_URL: 'http://marktat.example' }],
    ['MEILI_MASTER_KEY', { MEILI_MASTER_KEY: 'kurz' }],
    ['STORAGE_DRIVER', { STORAGE_DRIVER: 'local' }],
  ])('lehnt fehlendes oder unsicheres %s ab', (path, override) => {
    expect(issues({ ...production, ...override })).toContain(path);
  });

  it('lässt die lokale Entwicklung ohne diese Werte zu', () => {
    expect(issues({ DATABASE_URL: 'postgresql://x', SUPABASE_URL: 'http://localhost:54321' })).toEqual([]);
  });
});
