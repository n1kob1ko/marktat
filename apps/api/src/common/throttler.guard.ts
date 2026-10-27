import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-Limit je Konto (angemeldet) bzw. je IP (Gäste).
 * Der Browser spricht die API über den Next.js-Server an – dort haben alle Anfragen dieselbe IP. Limits je IP
 * würden dann für alle Personen gemeinsam gelten; deshalb zählt bei angemeldeten Anfragen das Konto.
 * Läuft nach dem AuthGuard, damit `request.user` gesetzt ist.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    if (request.user) return `user:${request.user.id}`;
    return request.ip ?? 'unknown';
  }
}
