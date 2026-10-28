import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Alert, Badge, Card, Skeleton } from '@marktat/ui';
import {
  APPEAL_STATUS_LABELS,
  DECISION_GROUND_LABELS,
  formatDate,
  formatDateTime,
  MODERATION_ACTION_LABELS,
  REPORT_REASON_LABELS,
  type ModerationDecisionView,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { FlashMessage } from '@/components/flash-message';
import { ActionBadge } from '@/components/admin/admin-ui';
import { AppealForm } from './appeal-form';

export const metadata: Metadata = { title: 'Entscheidung', robots: { index: false } };

export default function DecisionPage({ params, searchParams }: PageProps<'/konto/entscheidungen/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Decision params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Decision({ params, searchParams }: Pick<PageProps<'/konto/entscheidungen/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { token } = await requireUser(`/konto/entscheidungen/${id}`, { allowSuspended: true });
  let decision: ModerationDecisionView;
  try {
    decision = await api<ModerationDecisionView>(`/me/decisions/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/konto/entscheidungen" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Entscheidungen
      </Link>
      <FlashMessage hinweis={hinweis} />
      <Card className="space-y-4 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={decision.action} />
          {decision.reversed ? <Badge>Aufgehoben</Badge> : null}
        </div>
        <h2 className="font-sans text-xl font-bold tracking-normal text-ink-950">
          {decision.listing
            ? `„${decision.listing.title}“`
            : decision.deal
              ? `Angebot „${decision.deal.title}“`
              : decision.serviceProfile
                ? `Anbieterprofil „${decision.serviceProfile.title}“`
                : MODERATION_ACTION_LABELS[decision.action]}
        </h2>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
          <dt className="text-ink-500">Entschieden am</dt>
          <dd>{formatDateTime(decision.createdAt)}</dd>
          <dt className="text-ink-500">Maßnahme</dt>
          <dd>{MODERATION_ACTION_LABELS[decision.action]}</dd>
          {decision.reason ? (
            <>
              <dt className="text-ink-500">Art des Verstoßes</dt>
              <dd>{REPORT_REASON_LABELS[decision.reason]}</dd>
            </>
          ) : null}
          {decision.ground ? (
            <>
              <dt className="text-ink-500">Grundlage</dt>
              <dd>{DECISION_GROUND_LABELS[decision.ground]}</dd>
            </>
          ) : null}
          <dt className="text-ink-500">Begründung</dt>
          <dd className="leading-relaxed whitespace-pre-line text-ink-800">{decision.statement}</dd>
        </dl>
        <p className="text-xs leading-relaxed text-ink-500">
          Diese Entscheidung hat ein Mensch aus unserem Team getroffen, nicht automatisiert. Neben dem Einspruch kannst du dich an eine außergerichtliche Streitbeilegungsstelle nach
          Art. 21 DSA oder an die Gerichte wenden.
        </p>
      </Card>

      {decision.appeal ? (
        <Card className="space-y-2 p-5 sm:p-7">
          <h3 className="font-sans text-lg font-semibold tracking-normal">Dein Einspruch</h3>
          <p className="text-sm text-ink-500">
            Eingereicht am {formatDateTime(decision.appeal.createdAt)} · Status: <strong className="text-ink-900">{APPEAL_STATUS_LABELS[decision.appeal.status]}</strong>
          </p>
          <p className="text-sm whitespace-pre-line text-ink-700">{decision.appeal.body}</p>
          {decision.appeal.response ? (
            <Alert tone={decision.appeal.status === 'REVERSED' ? 'success' : 'info'} title={`Antwort vom ${formatDateTime(decision.appeal.decidedAt!)}`}>
              <p className="whitespace-pre-line">{decision.appeal.response}</p>
            </Alert>
          ) : null}
        </Card>
      ) : decision.canAppeal ? (
        <Card className="space-y-3 p-5 sm:p-7">
          <h3 className="font-sans text-lg font-semibold tracking-normal">Einspruch erheben</h3>
          <p className="text-sm text-ink-600">
            Du bist nicht einverstanden? Erkläre, warum die Entscheidung falsch ist. Möglich bis {formatDate(decision.appealDeadline!)}. Ein anderer Mensch aus dem Team prüft erneut
            und antwortet dir.
          </p>
          <AppealForm decisionId={decision.id} />
        </Card>
      ) : null}
    </div>
  );
}
