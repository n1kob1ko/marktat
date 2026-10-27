import type { User } from '../generated/prisma/client.js';
import type { ServiceProfileStatus, UserStatus } from '../generated/prisma/enums.js';
import type { MediaUrls } from '../images/media.js';
import type { ImageVariant } from '../images/image-processor.js';
import { logoUrl } from '../users/users.mapper.js';
import { isServiceProfilePublic } from './visibility.js';

type ProfileImageFields = {
  id: string;
  imageKey: string | null;
  status: ServiceProfileStatus;
  user: Pick<User, 'id' | 'logoKey' | 'accountType'> & { status: UserStatus; deletedAt: Date | null };
};

/** Profilbild: eigenes Bild, sonst das Firmenlogo gewerblicher Konten. Nicht öffentliche Profile nur signiert. */
export function serviceProfileImageUrl(profile: ProfileImageFields, urls: MediaUrls, variant: ImageVariant): string | null {
  if (profile.imageKey) {
    return urls.url('portfolio', `services/${profile.id}/image`, profile.id, profile.imageKey, variant, !isServiceProfilePublic(profile));
  }
  return profile.user.accountType === 'BUSINESS' && isServiceProfilePublic(profile) ? logoUrl(profile.user) : null;
}

export function portfolioImageUrl(
  profile: Omit<ProfileImageFields, 'imageKey'>,
  item: { id: string; imageKey: string | null; hiddenAt: Date | null },
  urls: MediaUrls,
  variant: ImageVariant,
): string | null {
  if (!item.imageKey) return null;
  const isPublic = isServiceProfilePublic(profile) && !item.hiddenAt;
  return urls.url('portfolio', `services/${profile.id}/portfolio/${item.id}/image`, item.id, item.imageKey, variant, !isPublic);
}
