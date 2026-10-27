import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_ERROR_CODES } from '@marktat/shared';
import type { UserRole } from '../generated/prisma/enums.js';
import { loadEnv, staffMfaRequired } from '../config/env.js';
import { ROLES_KEY } from './decorators.js';
import type { AuthUser } from './auth.types.js';

export const STEP_UP_KEY = 'stepUp';
/**
 * Kritische Aktion (Rollen, Sperren, Preise, Betriebsmodus, 2FA anderer zurücksetzen): Wer 2FA nutzt, muss den
 * Code kürzlich (STEP_UP_MAX_AGE_MINUTES) bestätigt haben – die Web-App fragt ihn direkt im Formular ab.
 */
export const StepUp = () => SetMetadata(STEP_UP_KEY, true);

export function isStaffRole(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'MODERATOR';
}

export interface MfaInput {
  aal: AuthUser['aal'];
  mfaVerifiedAt: number | null;
  /** 2FA ist für dieses Konto Pflicht (Team und STAFF_MFA_REQUIRED) */
  required: boolean;
  stepUp: boolean;
  maxAgeSeconds: number;
  nowSeconds: number;
}

/** Reine Entscheidung (getrennt testbar): null = erlaubt, sonst der Fehlercode. */
export function mfaDecision(input: MfaInput): (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES] | null {
  if (input.required && input.aal !== 'aal2') return AUTH_ERROR_CODES.mfaRequired;
  if (input.stepUp && input.aal === 'aal2') {
    const age = input.mfaVerifiedAt === null ? Infinity : input.nowSeconds - input.mfaVerifiedAt;
    if (age > input.maxAgeSeconds) return AUTH_ERROR_CODES.stepUpRequired;
  }
  return null;
}

const MESSAGES = {
  [AUTH_ERROR_CODES.mfaRequired]:
    'Für den Admin-Bereich ist die Zwei-Faktor-Anmeldung nötig. Richte sie unter „Sicherheit“ in deinem Konto ein bzw. bestätige deine Anmeldung mit dem Code.',
  [AUTH_ERROR_CODES.stepUpRequired]:
    'Bitte bestätige diese Aktion mit dem aktuellen Code aus deiner Authenticator-App.',
};

/** Prüfung für Aktionen, die nur in eine Richtung kritisch sind (z. B. Wechsel auf kostenpflichtig) */
export function assertStepUp(user: AuthUser): void {
  const env = loadEnv();
  const code = mfaDecision({
    aal: user.aal,
    mfaVerifiedAt: user.mfaVerifiedAt,
    required: isStaffRole(user.role) && staffMfaRequired(env),
    stepUp: true,
    maxAgeSeconds: env.STEP_UP_MAX_AGE_MINUTES * 60,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (code) throw new ForbiddenException({ message: MESSAGES[code], code });
}

/**
 * Läuft nach AuthGuard und RolesGuard. Admin-Routen (@Roles MODERATOR/ADMIN) verlangen bei 2FA-Pflicht eine
 * Sitzung mit zweitem Faktor (aal2); @StepUp() zusätzlich eine frische Bestätigung.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) return true;
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets) ?? [];
    const stepUp = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, targets) ?? false;
    const staffRoute = roles.some((role) => role !== 'USER');
    if (!staffRoute && !stepUp) return true;

    const env = loadEnv();
    const code = mfaDecision({
      aal: user.aal,
      mfaVerifiedAt: user.mfaVerifiedAt,
      required: isStaffRole(user.role) && staffMfaRequired(env),
      stepUp,
      maxAgeSeconds: env.STEP_UP_MAX_AGE_MINUTES * 60,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (code) throw new ForbiddenException({ message: MESSAGES[code], code });
    return true;
  }
}
