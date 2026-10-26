import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';

function contextFor(role?: 'USER' | 'MODERATOR' | 'ADMIN'): ExecutionContext {
  const request = { user: role ? { id: 'u1', role } : undefined };
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('lässt Routen ohne Rollenvorgabe durch', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor('USER'))).toBe(true);
  });

  it('erlaubt höheren Rollen den Zugriff', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['MODERATOR']);
    expect(guard.canActivate(contextFor('ADMIN'))).toBe(true);
  });

  it('verweigert niedrigeren Rollen den Zugriff', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(contextFor('MODERATOR'))).toThrow(ForbiddenException);
  });

  it('verweigert ohne angemeldeten Benutzer', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['USER']);
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
