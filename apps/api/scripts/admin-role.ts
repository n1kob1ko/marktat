/**
 * Rollen per Kommandozeile vergeben – so wird das erste Administratorkonto eingerichtet.
 *
 *   pnpm --filter @marktat/api admin:role -- --email anna@example.at --role ADMIN
 *   pnpm --filter @marktat/api admin:role -- --list
 *
 * Die Person muss sich vorher einmal registriert und angemeldet haben. Es gibt keinen öffentlichen
 * Bootstrap-Endpunkt und kein fest hinterlegtes Passwort; nötig ist Zugriff auf die Server-Umgebung (.env).
 */
import { parseArgs } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RoleChangeError, setRoleByEmail } from '../src/users/admin-role.js';

const ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
const { values } = parseArgs({ options: { email: { type: 'string' }, role: { type: 'string' }, list: { type: 'boolean' } } });

const prisma = new PrismaService();
try {
  if (values.list) {
    const staff = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'MODERATOR'] } }, select: { email: true, role: true, status: true }, orderBy: { role: 'desc' } });
    if (!staff.length) console.log('Noch keine Moderations- oder Administratorkonten.');
    for (const user of staff) console.log(`${user.role.padEnd(9)} ${user.status.padEnd(9)} ${user.email}`);
  } else {
    const role = values.role?.toUpperCase() as (typeof ROLES)[number] | undefined;
    if (!values.email || !role || !ROLES.includes(role)) {
      console.error('Aufruf: admin:role -- --email <adresse> --role USER|MODERATOR|ADMIN   (oder --list)');
      process.exitCode = 2;
    } else {
      const result = await setRoleByEmail(prisma, values.email, role);
      console.log(result.changed ? `Rolle geändert: ${result.from} → ${result.to}` : `Keine Änderung: Das Konto hat bereits die Rolle ${result.to}.`);
    }
  }
} catch (error) {
  if (error instanceof RoleChangeError) {
    console.error(error.message);
    process.exitCode = 1;
  } else throw error;
} finally {
  await prisma.$disconnect();
}
