import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Badge, Card, Skeleton } from '@marktat/ui';
import { formatDate, MODERATION_ACTION_LABELS, type ModerationDecisionView } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ActionBadge, AppealStatusBadge } from '@/components/admin/admin-ui';

export const metadata: Metadata = { title: 'Entscheidungen', robots: { index: false } };

export default function DecisionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Decisions />
    </Suspense>
  );
}

async function Decisions() {
  const { user, token } = await requireUser('/konto/entscheidungen', { allowSuspended: true });
  const decisions = await api<ModerationDecisionView[]>('/me/decisions', { token, cache: 'no-store' });

  return (
    <div className="max-w-3xl space-y-4">
      {user.status === 'SUSPENDED' ? (
        <Alert tone="danger" title="Dein Konto ist gesperrt">
          <p className="whitespace-pre-line">{user.suspension?.statement ?? 'Wir haben dein Konto gesperrt.'}</p>
          <p className="mt-2">
            Deine Anzeigen sind nicht mehr sichtbar. Du kannst die Entscheidung unten ansehen und Einspruch erheben, deine Daten exportieren oder dein Konto löschen.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {user.suspension?.decisionId ? (
              <Link href={`/konto/entscheidungen/${user.suspension.decisionId}`} className="font-semibold underline">Begründung und Einspruch</Link>
            ) : null}
            <Link href="/konto/datenschutz" className="font-semibold underline">Datenexport und Löschung</Link>
          </div>
        </Alert>
      ) : null}
      <p className="text-sm text-ink-600">
        Wenn wir eine Anzeige deaktivieren oder dein Konto sperren, findest du hier die Begründung. Gegen einschränkende Entscheidungen kannst du innerhalb von sechs Monaten Einspruch
        erheben – ein anderer Mensch aus dem Team prüft dann erneut.
      </p>
      {decisions.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="font-semibold text-ink-900">Keine Entscheidungen</p>
          <p className="mt-1 text-sm text-ink-500">Zu deinem Konto und deinen Anzeigen gibt es keine Moderationsentscheidungen.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {decisions.map((d) => (
            <li key={d.id}>
              <Link href={`/konto/entscheidungen/${d.id}`} className="block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand-300 sm:p-5">
                <span className="flex flex-wrap items-center gap-2">
                  <ActionBadge action={d.action} />
                  {d.reversed ? <Badge>Aufgehoben</Badge> : null}
                  {d.appeal ? <AppealStatusBadge status={d.appeal.status} /> : null}
                  <span className="text-xs text-ink-500">{formatDate(d.createdAt)}</span>
                </span>
                <span className="mt-2 block font-semibold text-ink-900">
                  {d.listing ? d.listing.title : d.deal ? d.deal.title : MODERATION_ACTION_LABELS[d.action]}
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-ink-600">{d.statement}</span>
                {d.canAppeal ? <span className="mt-2 block text-sm font-semibold text-brand-700">Einspruch möglich bis {formatDate(d.appealDeadline!)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
