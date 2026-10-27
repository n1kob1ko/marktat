import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UsersService } from '../users/users.service.js';
import { ALLOW_SUSPENDED_KEY, IS_PUBLIC_KEY } from './decorators.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';

/**
 * Globaler Guard: Jede Route verlangt ein gültiges Supabase-Token, außer sie ist mit @Public() markiert.
 * Das Profil in der App-Datenbank wird beim ersten Aufruf angelegt (siehe UsersService.syncFromClaims).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: SupabaseJwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Bitte melde dich an.');
    }

    const claims = await this.jwt.verify(token);
    const user = await this.users.syncFromClaims(claims, request.ip);
    // Öffentliche Seiten sehen gesperrte oder gelöschte Konten wie Gäste
    if (user.status !== 'ACTIVE' && isPublic) return true;
    if (user.status === 'DELETED') {
      throw new ForbiddenException('Dieses Konto wurde gelöscht.');
    }
    if (user.status === 'SUSPENDED' && !this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, targets)) {
      throw new ForbiddenException('Dein Konto ist gesperrt. Begründung und Einspruch findest du in deinem Konto.');
    }
    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' && value ? value : undefined;
  }
}
