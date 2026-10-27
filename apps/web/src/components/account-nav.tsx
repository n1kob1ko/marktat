'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@marktat/ui';
import { useUnread } from '@/lib/realtime';

const NAV = [
  { href: '/konto', label: 'Profil' },
  { href: '/konto/anzeigen', label: 'Meine Anzeigen' },
  { href: '/nachrichten', label: 'Nachrichten' },
  { href: '/konto/merkliste', label: 'Merkliste' },
  { href: '/konto/suchen', label: 'Gespeicherte Suchen' },
  { href: '/konto/benachrichtigungen', label: 'Benachrichtigungen' },
  { href: '/konto/mitteilungen', label: 'Mitteilungen' },
  { href: '/konto/datenschutz', label: 'Datenschutz' },
];

/** Reiter im Kontobereich; „Nachrichten“ zeigt die Zahl ungelesener Nachrichten live. */
export function AccountNav() {
  const pathname = usePathname();
  const unread = useUnread();
  return <AccountNavList pathname={pathname} unreadMessages={unread?.messages ?? 0} />;
}

/** Ohne aktiven Reiter – Platzhalter, solange der Pfad bei dynamischen Seiten noch nicht feststeht */
export function AccountNavFallback() {
  return <AccountNavList pathname={null} unreadMessages={0} />;
}

function AccountNavList({ pathname, unreadMessages }: { pathname: string | null; unreadMessages: number }) {
  return (
    <nav aria-label="Kontobereich" className="-mx-4 mt-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {NAV.map((item) => {
          const active = pathname !== null && (item.href === '/konto' ? pathname === '/konto' : pathname.startsWith(item.href));
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap sm:px-4',
                  active ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-600 hover:border-line-strong hover:text-ink-900',
                )}
              >
                {item.label}
                {item.href === '/nachrichten' && unreadMessages ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[0.6875rem] font-bold text-ink-950">
                    <span className="sr-only">, ungelesen: </span>
                    {unreadMessages}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
