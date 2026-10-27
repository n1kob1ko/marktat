import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card, Skeleton } from '@marktat/ui';
import { formatDate } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { SubmitButton } from '@/components/submit-button';
import { blockUserAction } from '@/app/nachrichten/actions';
import { NotificationSettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Benachrichtigungen', robots: { index: false } };

interface BlockedUser {
  id: string;
  displayName: string;
  blockedAt: string;
}

export default function NotificationsPage({ searchParams }: PageProps<'/konto/benachrichtigungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Notifications searchParams={searchParams} />
    </Suspense>
  );
}

async function Notifications({ searchParams }: Pick<PageProps<'/konto/benachrichtigungen'>, 'searchParams'>) {
  const [{ token, user }, params] = await Promise.all([requireUser('/konto/benachrichtigungen'), searchParams]);
  const blocked = await api<BlockedUser[]>('/me/blocks', { token, cache: 'no-store' }).catch(() => null);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <FlashMessage hinweis={hinweis} fehler={fehler} />
      </div>
      <Card className="p-5 sm:p-7">
        <h2 className="font-sans text-lg font-semibold tracking-normal">E-Mail-Benachrichtigungen</h2>
        <div className="mt-4">
          <NotificationSettingsForm messages={user.notifyMessagesByEmail} searches={user.notifySearchesByEmail} email={user.email} />
        </div>
      </Card>
      <Card className="p-5 sm:p-7">
        <h2 className="font-sans text-lg font-semibold tracking-normal">Blockierte Personen</h2>
        <p className="mt-1 text-sm text-ink-500">Blockierte Personen können dir keine Nachrichten schicken – und du ihnen auch nicht.</p>
        {!blocked ? (
          <p className="mt-4 text-sm text-danger-600" role="alert">
            Die Liste konnte gerade nicht geladen werden.
          </p>
        ) : blocked.length === 0 ? (
          <p className="mt-4 text-sm text-ink-600">Du hast niemanden blockiert.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {blocked.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{person.displayName}</p>
                  <p className="text-xs text-ink-500">Blockiert am {formatDate(person.blockedAt)}</p>
                </div>
                <form action={blockUserAction}>
                  <input type="hidden" name="userId" value={person.id} />
                  <SubmitButton name="action" value="unblock" variant="outline" size="sm">
                    Aufheben
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
