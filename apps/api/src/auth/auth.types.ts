import type { AccountType, UserRole, UserStatus } from '../generated/prisma/enums.js';

/** Relevante Claims eines Supabase-Access-Tokens. */
export interface SupabaseClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  /** Authenticator Assurance Level: aal1 = Passwort, aal2 = zusätzlich zweiter Faktor bestätigt */
  aal?: string;
  /** Anmeldemethoden der Sitzung mit Zeitpunkt (Sekunden), z. B. password, totp */
  amr?: { method: string; timestamp: number }[];
}

/** Am Request hängender, authentifizierter Benutzer (aus Token + App-Datenbank). */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  accountType: AccountType;
  status: UserStatus;
  /** Sicherheitsniveau der aktuellen Sitzung */
  aal: 'aal1' | 'aal2';
  /** Zeitpunkt der letzten Bestätigung mit dem zweiten Faktor (Sekunden seit 1970) oder null */
  mfaVerifiedAt: number | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

/** Konto aus der App-Datenbank, noch ohne Angaben zur Sitzung */
export type AccountUser = Omit<AuthUser, 'aal' | 'mfaVerifiedAt'>;

/** Sitzungsangaben aus den Token-Claims */
export function sessionSecurity(claims: SupabaseClaims): Pick<AuthUser, 'aal' | 'mfaVerifiedAt'> {
  const totp = (claims.amr ?? []).filter((entry) => entry.method === 'totp').map((entry) => entry.timestamp);
  return {
    aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
    mfaVerifiedAt: totp.length ? Math.max(...totp) : null,
  };
}
