import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/enums.js';
import { ROLES_KEY } from './decorators.js';

const RANK: Record<UserRole, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 };

/** Prüft @Roles(...). Höhere Rollen schließen niedrigere ein (ADMIN ⊃ MODERATOR ⊃ USER). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw new ForbiddenException('Keine Berechtigung.');
    const minRank = Math.min(...required.map((r) => RANK[r]));
    if (RANK[user.role] < minRank) throw new ForbiddenException('Keine Berechtigung.');
    return true;
  }
}
