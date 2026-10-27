import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { ConversationDetail, MessagePage } from '@marktat/shared';
import { buttonClasses } from '@marktat/ui';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ChatView } from '@/components/messages/chat-view';
import { InboxPanel, parseInboxParams } from '@/components/messages/inbox-panel';
import { ChatSkeleton, ListSkeleton } from '@/components/messages/skeletons';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

export default function ConversationPage({ params, searchParams }: PageProps<'/nachrichten/[id]'>) {
  return (
    <>
      <section aria-label="Unterhaltungen" className="hidden w-96 shrink-0 flex-col border-r border-line lg:flex">
        <Suspense fallback={<ListSkeleton />}>
          <Inbox params={params} searchParams={searchParams} />
        </Suspense>
      </section>
      <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<ChatSkeleton />}>
          <Chat params={params} searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}

async function Inbox({ params, searchParams }: Pick<PageProps<'/nachrichten/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/nachrichten/${id}`);
  return <InboxPanel token={token} params={parseInboxParams(query)} activeId={id} />;
}

async function Chat({ params, searchParams }: Pick<PageProps<'/nachrichten/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/nachrichten/${id}`);
  if (!ID_PATTERN.test(id)) notFound();

  let conversation: ConversationDetail;
  let page: MessagePage;
  try {
    [conversation, page] = await Promise.all([
      api<ConversationDetail>(`/conversations/${id}`, { token, cache: 'no-store' }),
      api<MessagePage>(`/conversations/${id}/messages`, { token, cache: 'no-store' }),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center" role="alert">
        <p className="font-semibold text-ink-900">Die Unterhaltung konnte gerade nicht geladen werden.</p>
        <p className="mt-1 text-sm text-ink-500">Bitte prüfe deine Verbindung und versuche es erneut.</p>
        <Link href={`/nachrichten/${id}`} className={buttonClasses({ variant: 'outline', className: 'mt-4' })}>
          Erneut versuchen
        </Link>
      </div>
    );
  }

  const inbox = new URLSearchParams();
  for (const key of ['filter', 'q']) {
    const value = query[key];
    if (typeof value === 'string' && value) inbox.set(key, value);
  }
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const fehler = typeof query.fehler === 'string' ? query.fehler : undefined;
  return (
    <>
      {hinweis || fehler ? (
        <div className="border-b border-line p-3">
          <FlashMessage hinweis={hinweis} fehler={fehler} />
        </div>
      ) : null}
      <ChatView key={conversation.id} conversation={conversation} initial={page} backHref={`/nachrichten${inbox.size ? `?${inbox}` : ''}`} />
    </>
  );
}
