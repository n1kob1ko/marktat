import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isUnlimitedAccount } from '@marktat/shared';
import type { Request } from 'express';

/**
 * Rate-Limit je Konto (angemeldet) bzw. je IP (Gäste).
 * Der Browser spricht die API über den Next.js-Server an – dort haben alle Anfragen dieselbe IP. Limits je IP
 * würden dann für alle Personen gemeinsam gelten; deshalb zählt bei angemeldeten Anfragen das Konto.
 * Administratorkonten sind ausgenommen. Läuft nach dem AuthGuard, damit `request.user` gesetzt ist.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (isUnlimitedAccount(context.switchToHttp().getRequest<Request>().user)) return true;
    return super.shouldSkip(context);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    if (request.user) return `user:${request.user.id}`;
    return request.ip ?? 'unknown';
  }
}
