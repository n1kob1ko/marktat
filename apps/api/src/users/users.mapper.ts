import type { MeResponse, PublicSeller } from '@marktat/shared';
import type { User } from '../generated/prisma/client.js';
import { loadEnv } from '../config/env.js';

/** Öffentliche Logo-URL (Weiterleitung auf den Bildspeicher); die Version ändert sich mit jedem neuen Logo. */
export function logoUrl(user: Pick<User, 'id' | 'logoKey'>): string | null {
  if (!user.logoKey) return null;
  const version = user.logoKey.split('/').pop()?.replace('.webp', '').slice(0, 12) ?? '1';
  return `${loadEnv().API_URL}/v1/dealers/${user.id}/logo?v=${version}`;
}

export function toMe(user: User, suspension: MeResponse['suspension'] = null): MeResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    accountType: user.accountType,
    role: user.role,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    phone: user.phone,
    companyName: user.companyName,
    companyRegisterNumber: user.companyRegisterNumber,
    vatId: user.vatId,
    companyAddress: user.companyAddress,
    website: user.website,
    showPhone: user.showPhone,
    logoUrl: logoUrl(user),
    notifyMessagesByEmail: user.notifyMessagesByEmail,
    notifySearchesByEmail: user.notifySearchesByEmail,
    status: user.status,
    suspension: user.status === 'SUSPENDED' ? suspension : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Öffentliche Verkäuferdaten – keine E-Mail, keine Telefonnummer. Profilbild = Händlerlogo (falls vorhanden). */
export function toPublicSeller(
  user: Pick<User, 'id' | 'displayName' | 'accountType' | 'companyName' | 'avatarUrl' | 'createdAt' | 'logoKey'>,
): PublicSeller {
  return {
    id: user.id,
    displayName: user.displayName,
    accountType: user.accountType,
    companyName: user.accountType === 'BUSINESS' ? user.companyName : null,
    avatarUrl: user.accountType === 'BUSINESS' ? (logoUrl(user) ?? user.avatarUrl) : user.avatarUrl,
    memberSince: user.createdAt.toISOString(),
  };
}
