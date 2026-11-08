/**
 * Anmeldung über Google bzw. Apple (Supabase Auth, OAuth). Welche Anbieter die Schaltflächen zeigen, legt
 * AUTH_PROVIDERS beim Bau fest (z. B. „google,apple“); die Zugangsdaten selbst kennt nur Supabase Auth
 * (GOTRUE_EXTERNAL_*). Ohne Eintrag gibt es nur E-Mail und Passwort.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SocialProvider, string> = { google: 'Google', apple: 'Apple' };

export function parseAuthProviders(value: string | undefined): SocialProvider[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is SocialProvider => (SOCIAL_PROVIDERS as readonly string[]).includes(v));
}

export const enabledProviders = parseAuthProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}
