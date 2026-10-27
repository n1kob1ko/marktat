/**
 * Notfall: Zwei-Faktor-Anmeldung eines Kontos zurücksetzen (z. B. Handy verloren und kein zweites Gerät).
 *
 *   pnpm --filter @marktat/api admin:mfa-reset -- --email anna@example.at
 *
 * Danach meldet sich die Person nur mit Passwort an und richtet 2FA unter /konto/sicherheit neu ein.
 * Nötig ist Zugriff auf die Server-Umgebung (Datenbank und SUPABASE_SERVICE_ROLE_KEY). Wird protokolliert.
 */
import { parseArgs } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SupabaseAdminClient } from '../src/privacy/supabase-admin.client.js';

const { values } = parseArgs({ args: process.argv.slice(2).filter((arg) => arg !== '--'), options: { email: { type: 'string' } } });

const prisma = new PrismaService();
try {
  const email = values.email?.trim().toLowerCase();
  if (!email) {
    console.error('Aufruf: admin:mfa-reset -- --email <adresse>');
    process.exitCode = 2;
  } else {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`Kein Konto mit der E-Mail ${email}.`);
      process.exitCode = 1;
    } else {
      const auth = new SupabaseAdminClient();
      const factors = await auth.listFactors(user.id);
      for (const factor of factors) await auth.deleteFactor(user.id, factor.id);
      await prisma.auditLog.create({
        data: { action: 'admin.mfa_reset', entityType: 'user', entityId: user.id, metadata: { removedFactors: factors.length, via: 'cli' } },
      });
      console.log(factors.length ? `${factors.length} Faktor(en) entfernt.` : 'Für dieses Konto war keine Zwei-Faktor-Anmeldung eingerichtet.');
    }
  }
} finally {
  await prisma.$disconnect();
}
