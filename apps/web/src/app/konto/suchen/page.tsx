import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Bell, BellOff, Pencil, Search } from 'lucide-react';
import { Alert, buttonClasses, Card, Input, Skeleton } from '@marktat/ui';
import { formatDate, SAVED_SEARCH_KIND_LABELS, SAVED_SEARCH_PATHS, type SavedSearch } from '@marktat/shared';
import { SAVED_SEARCH_NOTIFY_TEXT } from '@/lib/saved-searches';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ConfirmDeleteButton } from '@/components/confirm-delete-button';
import { SubmitButton } from '@/components/submit-button';
import { deleteSavedSearchAction, updateSavedSearchAction } from './actions';

export const metadata: Metadata = { title: 'Gespeicherte Suchen', robots: { index: false } };

export default function SavedSearchesPage({ searchParams }: PageProps<'/konto/suchen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SavedSearches searchParams={searchParams} />
    </Suspense>
  );
}

async function SavedSearches({ searchParams }: Pick<PageProps<'/konto/suchen'>, 'searchParams'>) {
  const [{ token, user }, params] = await Promise.all([requireUser('/konto/suchen'), searchParams]);
  const searches = await api<SavedSearch[]>('/me/searches', { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;
  const editing = typeof params.bearbeiten === 'string' ? params.bearbeiten : undefined;

  return (
    <div className="space-y-4">
      <FlashMessage hinweis={hinweis} fehler={fehler === 'name' ? undefined : fehler} />
      {fehler === 'name' ? <Alert tone="danger">Bitte gib einen Namen mit 1 bis 80 Zeichen ein.</Alert> : null}
      {!user.notifySearchesByEmail && searches.some((s) => s.notify) ? (
        <Alert tone="warning">
          E-Mails zu gespeicherten Suchen sind in deinen{' '}
          <Link href="/konto/benachrichtigungen" className="font-semibold underline">
            Benachrichtigungseinstellungen
          </Link>{' '}
          ausgeschaltet. Die Glocken unten wirken erst, wenn du sie dort einschaltest.
        </Alert>
      ) : null}

      {searches.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <Search className="mx-auto size-8 text-ink-300" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink-900">Noch keine gespeicherten Suchen</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
            Stell in der Suche, bei den Deals oder bei den Dienstleistungen deine Filter ein und tippe auf „Suche speichern“. Auf Wunsch bekommst du eine E-Mail, sobald etwas Neues dazukommt.
          </p>
          <Link href="/suche" className={buttonClasses({ variant: 'outline', className: 'mt-5' })}>
            Zur Suche
          </Link>
        </Card>
      ) : (
        <ul className="space-y-3">
          {searches.map((search) => {
            const href = `${SAVED_SEARCH_PATHS[search.kind]}?${new URLSearchParams(search.params)}`;
            return (
              <li key={search.id}>
                <Card className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between" data-testid="saved-search">
                  <div className="min-w-0 space-y-2">
                    {editing === search.id ? (
                      <form action={updateSavedSearchAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={search.id} />
                        <input type="hidden" name="intent" value="rename" />
                        <label htmlFor={`name-${search.id}`} className="sr-only">
                          Neuer Name
                        </label>
                        <Input id={`name-${search.id}`} name="name" defaultValue={search.name} maxLength={80} required autoFocus className="h-10 w-72 max-w-full" />
                        <SubmitButton size="sm">Speichern</SubmitButton>
                        <Link href="/konto/suchen" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                          Abbrechen
                        </Link>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded-md bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-700 ring-1 ring-line" data-testid="saved-search-kind">
                          {SAVED_SEARCH_KIND_LABELS[search.kind]}
                        </span>
                        <Link href={href} className="truncate font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                          {search.name}
                        </Link>
                        <Link
                          href={`/konto/suchen?bearbeiten=${search.id}`}
                          className="rounded-md p-1 text-ink-500 hover:bg-ink-900/5 hover:text-ink-900"
                          aria-label={`„${search.name}“ umbenennen`}
                          title="Umbenennen"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                    {search.labels.length ? (
                      <ul className="flex flex-wrap gap-1.5" aria-label="Filter">
                        {search.labels.map((label) => (
                          <li key={label} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-900">
                            {label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="text-xs text-ink-500">
                      Gespeichert am {formatDate(search.createdAt)}
                      {search.notify ? ` · ${SAVED_SEARCH_NOTIFY_TEXT[search.kind]}` : ''}
                      {search.lastNotifiedAt ? ` · zuletzt benachrichtigt am ${formatDate(search.lastNotifiedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={href} className={buttonClasses({ size: 'sm' })}>
                      <Search className="size-4" aria-hidden="true" /> Suchen
                    </Link>
                    <form action={updateSavedSearchAction}>
                      <input type="hidden" name="id" value={search.id} />
                      <SubmitButton
                        name="intent"
                        value={search.notify ? 'notify-off' : 'notify-on'}
                        variant="outline"
                        size="sm"
                        aria-pressed={search.notify}
                        title={search.notify ? 'E-Mail-Benachrichtigung ausschalten' : SAVED_SEARCH_NOTIFY_TEXT[search.kind]}
                      >
                        {search.notify ? <Bell className="size-4 fill-current text-brand-700" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
                        {search.notify ? 'Benachrichtigung an' : 'Benachrichtigung aus'}
                      </SubmitButton>
                    </form>
                    <form action={deleteSavedSearchAction}>
                      <input type="hidden" name="id" value={search.id} />
                      <ConfirmDeleteButton />
                    </form>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
