import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ALLOW_SUSPENDED_KEY, IS_PUBLIC_KEY, ROLES_KEY } from '../auth/decorators.js';
import { AdminDealsController } from '../deals/admin-deals.controller.js';
import { PrivacyController } from '../privacy/privacy.controller.js';
import { AdminController } from './admin.controller.js';
import { ModerationController } from './moderation.controller.js';

const reflector = new Reflector();

function handlers(controller: abstract new (...args: never[]) => unknown) {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => ({ name, handler: proto[name] as () => unknown }));
}

const ADMIN_ONLY = ['users', 'changeRole', 'restrictReporting', 'auditLog'];

describe('Admin-Routen', () => {
  it('verlangen ohne Ausnahme mindestens MODERATOR und sind nie öffentlich', () => {
    const list = handlers(AdminController);
    expect(list.length).toBeGreaterThan(15);
    for (const { name, handler } of list) {
      const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [handler, AdminController]);
      expect(roles, name).toBeDefined();
      expect(roles!.some((role) => role === 'MODERATOR' || role === 'ADMIN'), name).toBe(true);
      expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, AdminController]), name).toBeUndefined();
      expect(reflector.getAllAndOverride(ALLOW_SUSPENDED_KEY, [handler, AdminController]), name).toBeUndefined();
    }
  });

  it('schützt auch die Deal-Moderation; Zuordnung zu einem anderen Konto nur für Administratoren', () => {
    for (const { name, handler } of handlers(AdminDealsController)) {
      const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [handler, AdminDealsController]);
      expect(roles?.some((role) => role === 'MODERATOR' || role === 'ADMIN'), name).toBe(true);
      expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, AdminDealsController]), name).toBeUndefined();
    }
    const assign = (AdminDealsController.prototype as unknown as Record<string, () => unknown>).assignMerchant!;
    expect(reflector.getAllAndOverride(ROLES_KEY, [assign, AdminDealsController])).toEqual(['ADMIN']);
  });

  it('beschränkt Kontoverwaltung, Rollen und Protokoll auf Administratoren', () => {
    for (const name of ADMIN_ONLY) {
      const handler = (AdminController.prototype as unknown as Record<string, () => unknown>)[name]!;
      expect(reflector.getAllAndOverride(ROLES_KEY, [handler, AdminController]), name).toEqual(['ADMIN']);
    }
    const retry = (PrivacyController.prototype as unknown as Record<string, () => unknown>).retry!;
    expect(reflector.getAllAndOverride(ROLES_KEY, [retry, PrivacyController])).toEqual(['ADMIN']);
  });

  it('macht für gesperrte Konten nur Entscheidungen, Einspruch, Mitteilungen, Export und Löschung erreichbar', () => {
    const allowed = [...handlers(ModerationController), ...handlers(PrivacyController)]
      .filter(({ handler }) => reflector.get(ALLOW_SUSPENDED_KEY, handler))
      .map(({ name }) => name)
      .sort();
    expect(allowed).toEqual(['appeal', 'decision', 'decisions', 'export', 'markRead', 'notificationList', 'requestDeletion'].sort());
  });
});
