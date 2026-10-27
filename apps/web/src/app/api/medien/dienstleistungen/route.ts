import { PORTFOLIO_IMAGE_RIGHTS } from '@marktat/shared';
import { proxyImageDelete, proxyImageUpload } from '@/lib/media-proxy';

const RIGHTS = new Set<string>(PORTFOLIO_IMAGE_RIGHTS);

/** Profilbild bzw. Logo des eigenen Anbieterprofils hochladen oder entfernen (Bildrechte sind Pflicht). */
export async function PUT(request: Request) {
  return proxyImageUpload(request, 'media/service-profile', RIGHTS);
}

export async function DELETE(request: Request) {
  return proxyImageDelete(request, 'me/service-profile/image');
}
