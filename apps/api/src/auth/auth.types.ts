import type { AccountType, UserRole, UserStatus } from '../generated/prisma/enums.js';

/** Relevante Claims eines Supabase-Access-Tokens. */
export interface SupabaseClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

/** Am Request hängender, authentifizierter Benutzer (aus Token + App-Datenbank). */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  accountType: AccountType;
  status: UserStatus;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
