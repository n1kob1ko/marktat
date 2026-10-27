import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Alert, Skeleton } from '@marktat/ui';
import { formatDateTime, type AdminAppealItem } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ENTITY_ID, param } from '@/lib/admin';
import { AppealStatusBadge, DecisionList, PersonLink, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { AppealDecisionForm } from '@/components/admin/forms';

export const metadata: Metadata = { title: 'Einspruch' };

export default function AppealPage({ params, searchParams }: PageProps<'/admin/einsprueche/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Appeal params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Appeal({ params, searchParams }: Pick<PageProps<'/admin/einsprueche/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/einsprueche/${id}`);
  let appeal: AdminAppealItem;
  try {
    appeal = await api<AdminAppealItem>(`/admin/appeals/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const own = appeal.user.id === user.id;
  const sameModerator = appeal.decision.moderator?.id === user.id;

  return (
    <div className="space-y-6">
      <Link href="/admin/einsprueche" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Einsprüche
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <AppealStatusBadge status={appeal.status} />
        <h2 className="font-sans text-2xl font-bold tracking-normal text-ink-950">Einspruch von {appeal.user.displayName}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
          Eingegangen {formatDateTime(appeal.createdAt)} · <PersonLink person={appeal.user} /> <UserStatusBadge status={appeal.user.status} />
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section title="Begründung des Einspruchs">
            <p className="text-sm leading-relaxed break-words whitespace-pre-line text-ink-800">{appeal.body}</p>
          </Section>
          <Section title="Angefochtene Entscheidung">
            <DecisionList decisions={[{ ...appeal.decision, appeal: null }]} showUser />
          </Section>
        </div>
        <aside>
          <Section title={appeal.status === 'OPEN' ? 'Entscheiden' : 'Ergebnis'}>
            {appeal.status !== 'OPEN' ? (
              <div className="space-y-2 text-sm">
                <p className="text-ink-600">
                  {appeal.decidedAt ? formatDateTime(appeal.decidedAt) : ''} von <PersonLink person={appeal.reviewer} />
                </p>
                <p className="whitespace-pre-line text-ink-800">{appeal.response}</p>
              </div>
            ) : own ? (
              <Alert tone="warning">Über deinen eigenen Einspruch entscheidet jemand anderer.</Alert>
            ) : (
              <div className="space-y-4">
                {sameModerator ? (
                  <Alert tone="warning">
                    Du hast die ursprüngliche Entscheidung getroffen. Wenn möglich, sollte jemand anderer den Einspruch prüfen
                    {user.role === 'ADMIN' ? ' – als Administrator kannst du trotzdem entscheiden, das wird vermerkt.' : '.'}
                  </Alert>
                ) : null}
                {sameModerator && user.role !== 'ADMIN' ? null : <AppealDecisionForm id={appeal.id} />}
              </div>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
