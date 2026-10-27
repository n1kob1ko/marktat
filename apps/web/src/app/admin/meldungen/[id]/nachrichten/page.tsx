import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Alert, buttonClasses, Card, cn, Skeleton } from '@marktat/ui';
import { formatDateTime, type ReportedConversation } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';

export const metadata: Metadata = { title: 'Gemeldete Nachrichten' };

/**
 * Nachrichten einer gemeldeten Unterhaltung. Erst nach ausdrücklicher Bestätigung abgerufen, weil jeder
 * Abruf protokolliert wird – so lösen weder Vorschau noch versehentliche Klicks einen Zugriff aus.
 */
export default function ReportedMessagesPage({ params, searchParams }: PageProps<'/admin/meldungen/[id]/nachrichten'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReportedMessages params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportedMessages({ params, searchParams }: Pick<PageProps<'/admin/meldungen/[id]/nachrichten'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { token } = await requireStaff(`/admin/meldungen/${id}/nachrichten`);
  const back = (
    <Link href={`/admin/meldungen/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" /> Zurück zur Meldung
    </Link>
  );

  if (query.bestaetigt !== '1') {
    return (
      <div className="max-w-2xl space-y-5">
        {back}
        <Card className="space-y-4 p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warning-700" aria-hidden="true" />
            <div className="space-y-2 text-sm text-ink-700">
              <h2 className="font-sans text-lg font-semibold tracking-normal text-ink-950">Private Nachrichten öffnen?</h2>
              <p>Du siehst die Nachrichten dieser Unterhaltung bis zum Zeitpunkt der Meldung – nur, um die Meldung zu prüfen.</p>
              <p>Der Zugriff wird mit deinem Namen, Zeitpunkt und der Meldung im Protokoll gespeichert. Gib nichts davon außerhalb der Prüfung weiter.</p>
            </div>
          </div>
          <form method="get" className="flex flex-wrap gap-2">
            <input type="hidden" name="bestaetigt" value="1" />
            <button type="submit" className={buttonClasses()}>Nachrichten zur Prüfung öffnen</button>
            <Link href={`/admin/meldungen/${id}`} className={buttonClasses({ variant: 'ghost' })}>Abbrechen</Link>
          </form>
        </Card>
      </div>
    );
  }

  let conversation: ReportedConversation;
  try {
    conversation = await api<ReportedConversation>(`/admin/reports/${id}/messages`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 409)) {
      return (
        <div className="max-w-2xl space-y-5">
          {back}
          <Alert tone="warning">{error.message}</Alert>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="max-w-3xl space-y-5">
      {back}
      <Alert tone="info">Zugriff protokolliert. Angezeigt werden nur Nachrichten bis zum Zeitpunkt der Meldung.</Alert>
      {conversation.listing ? (
        <p className="text-sm text-ink-600">
          Zum Inserat{' '}
          <Link href={`/admin/inserate/${conversation.listing.id}`} className="font-medium text-brand-700 hover:underline">{conversation.listing.title}</Link>
        </p>
      ) : null}
      {conversation.truncated ? <p className="text-sm text-ink-500">Ältere Nachrichten sind ausgeblendet (höchstens die letzten 100).</p> : null}
      <ol className="space-y-3" aria-label="Nachrichten">
        {conversation.messages.map((m) => (
          <li key={m.id} className={cn('flex', m.author === 'reporter' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', m.author === 'reporter' ? 'bg-brand-50 text-ink-900' : 'border border-line bg-surface text-ink-900')}>
              <p className="text-xs font-semibold text-ink-500">{m.author === 'reporter' ? 'Meldende Person' : 'Gemeldete Person'} · {formatDateTime(m.createdAt)}</p>
              <p className="mt-1 break-words whitespace-pre-line">{m.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {conversation.messages.length === 0 ? <p className="text-sm text-ink-500">Keine Nachrichten.</p> : null}
    </div>
  );
}
