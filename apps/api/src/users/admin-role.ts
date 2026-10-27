import type { PrismaClient } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';

export class RoleChangeError extends Error {}

/**
 * Rollenvergabe mit Serverzugang (Kommandozeile) – der einzige Weg, ADMIN zu vergeben oder zu entziehen.
 * Es gibt dafür bewusst keinen HTTP-Endpunkt und keine fest hinterlegten Zugangsdaten: Wer die Datenbank-
 * Zugangsdaten des Servers hat, kann ohnehin alles; ohne sie ist keine Hochstufung möglich.
 */
export async function setRoleByEmail(prisma: PrismaClient, emailInput: string, role: UserRole) {
  const email = emailInput.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    // Dieselbe Sperre wie bei Sperren im Admin-Bereich: verhindert, dass parallel der letzte Admin verschwindet
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-accounts'))`;
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true, status: true } });
    if (!user) {
      throw new RoleChangeError(`Kein Konto mit der E-Mail ${email}. Die Person muss sich zuerst einmal registrieren und anmelden.`);
    }
    if (user.status !== 'ACTIVE' && role !== 'USER') throw new RoleChangeError('Das Konto ist gesperrt oder gelöscht.');
    if (user.role === role) return { id: user.id, from: user.role, to: role, changed: false };
    if (user.role === 'ADMIN') {
      const otherAdmins = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: user.id } } });
      if (otherAdmins === 0) throw new RoleChangeError('Das ist das letzte aktive Administratorkonto. Vergib zuerst einem anderen Konto ADMIN.');
    }
    await tx.user.update({ where: { id: user.id }, data: { role } });
    await tx.auditLog.create({
      data: { action: 'admin.role_changed', entityType: 'user', entityId: user.id, metadata: { from: user.role, to: role, via: 'cli' } },
    });
    return { id: user.id, from: user.role, to: role, changed: true };
  });
}
