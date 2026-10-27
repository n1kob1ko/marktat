import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Bell } from 'lucide-react';
import { buttonClasses, Card, cn, Skeleton } from '@marktat/ui';
import { formatDateTime, type NotificationList } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser, safeRedirectPath } from '@/lib/auth';
import { markNotificationsReadAction } from './actions';

export const metadata: Metadata = { title: 'Mitteilungen', robots: { index: false } };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  const { token } = await requireUser('/konto/mitteilungen', { allowSuspended: true });
  const { items, unread } = await api<NotificationList>('/me/notifications', { token, cache: 'no-store' });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          Hinweise zu Meldungen, Entscheidungen über deine Anzeigen oder dein Konto und zu Einsprüchen.{' '}
          <Link href="/konto/entscheidungen" className="font-semibold text-brand-700 hover:underline">Alle Entscheidungen</Link>
        </p>
        {unread ? (
          <form action={markNotificationsReadAction}>
            <button type="submit" className={buttonClasses({ variant: 'outline', size: 'sm' })}>Alle als gelesen markieren</button>
          </form>
        ) : null}
      </div>
      {items.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <Bell className="mx-auto size-8 text-ink-300" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink-900">Keine Mitteilungen</p>
          <p className="mt-1 text-sm text-ink-500">Hier erfährst du, wie wir über deine Meldungen entschieden haben.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id}>
              <Card className={cn('p-4 sm:p-5', !n.readAt && 'border-brand-300 bg-brand-50/40')}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-ink-900">
                    {!n.readAt ? <span className="sr-only">Ungelesen: </span> : null}
                    {n.title}
                  </p>
                  <span className="shrink-0 text-xs text-ink-500">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-ink-700">{n.body}</p>
                {n.link ? (
                  <Link href={safeRedirectPath(n.link, '/konto/mitteilungen')} className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
                    Details ansehen
                  </Link>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
