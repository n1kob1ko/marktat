import type { Prisma } from '../generated/prisma/client.js';
import type { ServiceProfileStatus, ServiceProjectStatus, UserStatus } from '../generated/prisma/enums.js';

/** Öffentlich sichtbar: Profil freigeschaltet, Konto aktiv und nicht gelöscht */
export function publicServiceProfileWhere(): Prisma.ServiceProfileWhereInput {
  return { status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } };
}

export function isServiceProfilePublic(profile: { status: ServiceProfileStatus; user: { status: UserStatus; deletedAt: Date | null } }) {
  return profile.status === 'ACTIVE' && profile.user.status === 'ACTIVE' && profile.user.deletedAt === null;
}

/** Projektauftrag öffentlich: sichtbar geschaltet, Laufzeit nicht vorbei, Konto aktiv und nicht gelöscht */
export function publicProjectWhere(now = new Date()): Prisma.ServiceProjectWhereInput {
  return { status: 'ACTIVE', expiresAt: { gt: now }, user: { status: 'ACTIVE', deletedAt: null } };
}

export function isProjectPublic(project: { status: ServiceProjectStatus; expiresAt: Date | null; user: { status: UserStatus; deletedAt: Date | null } }, now = new Date()) {
  return project.status === 'ACTIVE' && project.expiresAt !== null && project.expiresAt > now && project.user.status === 'ACTIVE' && project.user.deletedAt === null;
}
