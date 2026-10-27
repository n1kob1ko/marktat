import type { Prisma } from '../generated/prisma/client.js';
import type { ServiceProfileStatus, UserStatus } from '../generated/prisma/enums.js';

/** Öffentlich sichtbar: Profil freigeschaltet, Konto aktiv und nicht gelöscht */
export function publicServiceProfileWhere(): Prisma.ServiceProfileWhereInput {
  return { status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } };
}

export function isServiceProfilePublic(profile: { status: ServiceProfileStatus; user: { status: UserStatus; deletedAt: Date | null } }) {
  return profile.status === 'ACTIVE' && profile.user.status === 'ACTIVE' && profile.user.deletedAt === null;
}
