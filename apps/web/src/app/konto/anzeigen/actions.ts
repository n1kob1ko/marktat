'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { PRODUCT_CODES, type BookingResult, type ProductCode } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';

type ListingAction = 'publish' | 'pause' | 'resume' | 'resubmit' | 'delete';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

/** Statuswechsel aus „Meine Anzeigen“ und der Detailseite. Berechtigung prüft die API. */
export async function listingStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '') as ListingAction;
  const returnTo = formData.get('returnTo') === 'detail' ? `/anzeige/${id}` : '/konto/anzeigen';
  if (!ID_PATTERN.test(id) || !['publish', 'pause', 'resume', 'resubmit', 'delete'].includes(action)) {
    redirect('/konto/anzeigen?fehler=aktion');
  }
  const { token } = await requireUser('/konto/anzeigen');

  let message = '';
  try {
    if (action === 'delete') {
      await api(`/listings/${id}`, { method: 'DELETE', token });
      message = 'geloescht';
    } else {
      await api(`/listings/${id}/${action}`, { method: 'POST', token });
      message = { publish: 'veroeffentlicht', pause: 'pausiert', resume: 'fortgesetzt', resubmit: 'eingereicht' }[action];
    }
  } catch (error) {
    // Veröffentlichen kostet etwas (nur im kostenpflichtigen Betrieb): Buchung über die Leistungsseite
    if (error instanceof ApiError && error.status === 402) redirect(`/konto/anzeigen/${id}/leistungen?fehler=zahlpflichtig`);
    const reason =
      error instanceof ApiError && error.status === 400
        ? 'unvollstaendig'
        : error instanceof ApiError && error.status === 409 && action === 'resubmit'
          ? 'nicht-ueberarbeitet'
          : 'aktion';
    redirect(`${returnTo}?fehler=${reason}`);
  }
  updateTag('listings');
  revalidatePath('/konto/anzeigen');
  redirect(action === 'delete' ? '/konto/anzeigen?hinweis=geloescht' : `${returnTo}?hinweis=${message}`);
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Zusatzleistung buchen (Hervorheben, Top, Hochschieben, im kostenpflichtigen Betrieb auch Veröffentlichen).
 * Preis, Limits und Berechtigung bestimmt ausschließlich die API; der Schlüssel verhindert Doppelbuchungen.
 */
export async function bookPromotionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const product = String(formData.get('product') ?? '') as ProductCode;
  const idempotencyKey = String(formData.get('key') ?? '');
  const back = formData.get('returnTo') === 'leistungen' ? `/konto/anzeigen/${id}/leistungen` : '/konto/anzeigen';
  if (!ID_PATTERN.test(id) || !PRODUCT_CODES.includes(product) || !KEY_PATTERN.test(idempotencyKey)) redirect(`${back}?fehler=aktion`);
  const { token } = await requireUser(back);

  let result: BookingResult;
  try {
    result = await api<BookingResult>(`/listings/${id}/bookings`, { method: 'POST', token, body: { product, idempotencyKey } });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    // Den genauen Grund (z. B. „Wieder möglich ab …“) zeigt die Leistungsseite je Leistung an
    const reason = status === 409 ? 'nicht-buchbar' : status === 429 ? 'zu-viele-buchungen' : status === 503 ? 'zahlung-nicht-moeglich' : 'aktion';
    redirect(`/konto/anzeigen/${id}/leistungen?fehler=${reason}`);
  }
  // Kostenpflichtig: weiter zu Stripe Checkout, freigeschaltet wird erst nach bestätigter Zahlung
  if (result.checkoutUrl) redirect(result.checkoutUrl);
  updateTag('listings');
  revalidatePath('/konto/anzeigen');
  redirect(`${back}?hinweis=gebucht-${product}`);
}
