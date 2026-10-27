import Link from 'next/link';
import { CircleUserRound, ShieldCheck } from 'lucide-react';
import { buttonClasses } from '@marktat/ui';
import type { UnreadSummary } from '@marktat/shared';
import { api } from '@/lib/api';
import { getAccessToken, getCurrentUser, isStaff } from '@/lib/auth';
import { HeaderInbox, SessionSync } from './header-inbox';
import { logoutAction } from '@/app/(auth)/actions';

/** Liest die Sitzung – steht deshalb im Header hinter einer Suspense-Grenze. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <SessionSync userId={null} />
        <Link href="/anmelden" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          Anmelden
        </Link>
      </>
    );
  }
  const token = await getAccessToken();
  const unread = await api<UnreadSummary>('/me/unread', { token: token ?? undefined, cache: 'no-store' }).catch(
    (): UnreadSummary => ({ messages: 0, conversations: 0 }),
  );
  return (
    <div className="flex items-center gap-1">
      <SessionSync userId={user.id} />
      <HeaderInbox initialUnread={unread} />
      {isStaff(user) ? (
        // Auf schmalen Bildschirmen über „Mein Konto“ erreichbar – im Header ist dort kein Platz
        <Link href="/admin" className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'hidden sm:inline-flex' })} aria-label="Moderation">
          <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          <span className="hidden xl:inline">Moderation</span>
        </Link>
      ) : null}
      <Link href="/konto" className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'max-w-44' })}>
        <CircleUserRound className="size-5 shrink-0" aria-hidden="true" />
        <span className="hidden truncate lg:inline">{user.displayName}</span>
        <span className="lg:hidden">Konto</span>
      </Link>
      <form action={logoutAction} className="hidden sm:block">
        <button type="submit" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          Abmelden
        </button>
      </form>
    </div>
  );
}
