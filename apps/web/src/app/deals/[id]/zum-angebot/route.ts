import { NextResponse, type NextRequest } from 'next/server';
import { AFFILIATE_URL_MAX_LENGTH, isSafeExternalUrl } from '@marktat/shared';
import { api } from '@/lib/api';
import { serverEnv } from '@/lib/env';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;

/**
 * „Zum Angebot“: zählt den Klick in der API und leitet auf den Shop des Händlers weiter. Ziel ist nur die
 * gespeicherte, geprüfte https-Adresse eines sichtbaren Deals – nie ein Parameter aus der Anfrage (keine offene
 * Weiterleitung). Ist das Angebot nicht mehr verfügbar, geht es zurück zur Detailseite.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/deals/[id]/zum-angebot'>) {
  const { id } = await params;
  const fallback = new URL(ENTITY_ID.test(id) ? `/deals/${id}` : '/deals', serverEnv.webUrl);
  if (!ENTITY_ID.test(id)) return NextResponse.redirect(fallback, 303);
  try {
    const { url } = await api<{ url: string }>(`/deals/${id}/click`, { method: 'POST', cache: 'no-store' });
    // Affiliate-Deals: Tracking-Link des Netzwerks (länger, da mit Zieladresse)
    if (!isSafeExternalUrl(url, AFFILIATE_URL_MAX_LENGTH)) return NextResponse.redirect(fallback, 303);
    const response = NextResponse.redirect(url, 303);
    response.headers.set('Referrer-Policy', 'origin');
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  } catch {
    return NextResponse.redirect(fallback, 303);
  }
}
