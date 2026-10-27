import { PORTFOLIO_IMAGE_RIGHTS } from '@marktat/shared';
import { json, proxyImageDelete, proxyImageUpload } from '@/lib/media-proxy';

const RIGHTS = new Set<string>(PORTFOLIO_IMAGE_RIGHTS);
const ENTITY_ID = /^[a-z0-9]{20,40}$/;

/** Bild eines Portfolio-Eintrags hochladen oder entfernen (Bildrechte sind Pflicht, fremde Bilder nicht erlaubt). */
export async function PUT(request: Request, { params }: RouteContext<'/api/medien/dienstleistungen/portfolio/[id]'>) {
  const { id } = await params;
  if (!ENTITY_ID.test(id)) return json(404, { message: 'Diesen Eintrag gibt es nicht.' });
  return proxyImageUpload(request, `media/service-portfolio/${id}`, RIGHTS);
}

export async function DELETE(request: Request, { params }: RouteContext<'/api/medien/dienstleistungen/portfolio/[id]'>) {
  const { id } = await params;
  if (!ENTITY_ID.test(id)) return json(404, { message: 'Diesen Eintrag gibt es nicht.' });
  return proxyImageDelete(request, `me/service-profile/portfolio/${id}/image`);
}
