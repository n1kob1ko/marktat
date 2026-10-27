import { Suspense } from 'react';
import { MessagesSquare } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { InboxPanel, parseInboxParams } from '@/components/messages/inbox-panel';
import { ListSkeleton } from '@/components/messages/skeletons';

export default function MessagesPage({ searchParams }: PageProps<'/nachrichten'>) {
  return (
    <>
      <section aria-label="Unterhaltungen" className="flex w-full min-w-0 flex-col border-line lg:w-96 lg:shrink-0 lg:border-r">
        <Suspense fallback={<ListSkeleton />}>
          <Inbox searchParams={searchParams} />
        </Suspense>
      </section>
      <div className="hidden flex-1 flex-col items-center justify-center bg-canvas/40 p-8 text-center lg:flex">
        <MessagesSquare className="size-10 text-ink-300" aria-hidden="true" />
        <p className="mt-3 font-semibold text-ink-900">Wähle eine Unterhaltung</p>
        <p className="mt-1 max-w-sm text-sm text-ink-500">Hier erscheint der Verlauf. Neue Nachrichten kommen automatisch an – ohne Neuladen.</p>
      </div>
    </>
  );
}

async function Inbox({ searchParams }: Pick<PageProps<'/nachrichten'>, 'searchParams'>) {
  const [params, { token }] = await Promise.all([searchParams, requireUser('/nachrichten')]);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;
  return (
    <>
      {hinweis || fehler ? (
        <div className="px-4 pt-4">
          <FlashMessage hinweis={hinweis} fehler={fehler} />
        </div>
      ) : null}
      <InboxPanel token={token} params={parseInboxParams(params)} />
    </>
  );
}
