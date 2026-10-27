'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle } from 'lucide-react';
import type { UnreadSummary } from '@marktat/shared';
import { buttonClasses, cn } from '@marktat/ui';
import { resetRealtime, seedUnread, useRealtime, useUnread } from '@/lib/realtime';
import { resetFavoriteStates } from './favorites/favorite-store';

let lastUserId: string | null | undefined;
const keepAlive = () => {};

/** Verwirft zwischengespeicherte Zustände (Herzen, Zähler, Verbindung), wenn sich die angemeldete Person ändert. */
export function SessionSync({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (lastUserId !== undefined && lastUserId !== userId) {
      resetRealtime();
      resetFavoriteStates();
    }
    lastUserId = userId;
  }, [userId]);
  return null;
}

/** Nachrichten mit Ungelesen-Zähler (live) und Merkliste im Header. */
export function HeaderInbox({ initialUnread }: { initialUnread: UnreadSummary }) {
  const unread = useUnread(initialUnread) ?? initialUnread;
  const pathname = usePathname();
  useEffect(() => seedUnread(initialUnread), [initialUnread]);
  // Hält die Echtzeit-Verbindung auf jeder Seite offen; der Zähler aktualisiert sich über useUnread
  useRealtime(keepAlive);

  const count = unread.messages;
  const label = count ? `Nachrichten, ${count} ungelesen` : 'Nachrichten';
  const active = pathname.startsWith('/nachrichten');
  return (
    <>
      <Link
        href="/konto/merkliste"
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'hidden w-10 px-0 sm:inline-flex' })}
        aria-label="Merkliste"
        title="Merkliste"
      >
        <Heart className="size-5" aria-hidden="true" />
      </Link>
      <Link
        href="/nachrichten"
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: cn('relative w-10 px-0', active && 'bg-ink-900/5') })}
        aria-label={label}
        title={label}
        aria-current={active ? 'page' : undefined}
        data-testid="header-messages"
      >
        <MessageCircle className="size-5" aria-hidden="true" />
        {count ? (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[0.6875rem] leading-none font-bold text-ink-950 ring-2 ring-surface"
            aria-hidden="true"
            data-testid="unread-badge"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </>
  );
}
