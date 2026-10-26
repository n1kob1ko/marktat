import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { loadEnv } from '../config/env.js';
import type { SupabaseClaims } from './auth.types.js';

/**
 * Prüft Supabase-Access-Tokens lokal (ohne Netzwerkaufruf pro Anfrage):
 * - HS256 mit SUPABASE_JWT_SECRET (lokales GoTrue, ältere Supabase-Projekte)
 * - sonst asymmetrisch über den JWKS-Endpunkt des Projekts (gecacht von jose)
 */
@Injectable()
export class SupabaseJwtService {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private readonly issuer: string;
  private readonly secret?: Uint8Array;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor() {
    const env = loadEnv();
    this.issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    if (env.SUPABASE_JWT_SECRET) {
      this.secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    } else {
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
  }

  async verify(token: string): Promise<SupabaseClaims> {
    try {
      const options = { issuer: this.issuer, audience: 'authenticated' };
      const { payload } = this.secret
        ? await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] })
        : await jwtVerify(token, this.jwks!, options);
      return this.toClaims(payload);
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new UnauthorizedException('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
      }
      if (error instanceof errors.JOSEError) {
        // Kein Token-Inhalt ins Log schreiben
        this.logger.warn(`Ungültiges Access-Token: ${error.code}`);
        throw new UnauthorizedException('Ungültige Anmeldung.');
      }
      throw error;
    }
  }

  private toClaims(payload: JWTPayload): SupabaseClaims {
    if (!payload.sub || payload['role'] !== 'authenticated') {
      throw new UnauthorizedException('Ungültige Anmeldung.');
    }
    return payload as SupabaseClaims;
  }
}
