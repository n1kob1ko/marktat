import type { MeResponse, PublicSeller } from '@marktat/shared';
import type { User } from '../generated/prisma/client.js';

export function toMe(user: User): MeResponse {
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
    createdAt: user.createdAt.toISOString(),
  };
}

/** Öffentliche Verkäuferdaten – keine E-Mail, keine Telefonnummer. */
export function toPublicSeller(
  user: Pick<User, 'id' | 'displayName' | 'accountType' | 'companyName' | 'avatarUrl' | 'createdAt'>,
): PublicSeller {
  return {
    id: user.id,
    displayName: user.displayName,
    accountType: user.accountType,
    companyName: user.accountType === 'BUSINESS' ? user.companyName : null,
    avatarUrl: user.avatarUrl,
    memberSince: user.createdAt.toISOString(),
  };
}
