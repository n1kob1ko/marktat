'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';

type ListingAction = 'publish' | 'pause' | 'resume' | 'delete';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

/** Statuswechsel aus „Meine Anzeigen“ und der Detailseite. Berechtigung prüft die API. */
export async function listingStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '') as ListingAction;
  const returnTo = formData.get('returnTo') === 'detail' ? `/anzeige/${id}` : '/konto/anzeigen';
  if (!ID_PATTERN.test(id) || !['publish', 'pause', 'resume', 'delete'].includes(action)) {
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
      message = action === 'publish' ? 'veroeffentlicht' : action === 'pause' ? 'pausiert' : 'fortgesetzt';
    }
  } catch (error) {
    const reason = error instanceof ApiError && error.status === 400 ? 'unvollstaendig' : 'aktion';
    redirect(`${returnTo}?fehler=${reason}`);
  }
  updateTag('listings');
  revalidatePath('/konto/anzeigen');
  redirect(action === 'delete' ? '/konto/anzeigen?hinweis=geloescht' : `${returnTo}?hinweis=${message}`);
}
