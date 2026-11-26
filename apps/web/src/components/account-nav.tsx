'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@marktat/ui';
import {
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Heart,
  Inbox,
  LayoutList,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useUnread } from '@/lib/realtime';
import { findActiveHref, SectionNav, type SectionNavGroup } from './section-nav';

/** Seiten ohne eigenen Eintrag, die zu einem Eintrag gehören */
const ALIASES: Record<string, string> = {
  '/konto/entscheidungen': '/konto/mitteilungen',
};

function buildGroups({ unreadMessages, showDeals }: { unreadMessages: number; showDeals: boolean }): SectionNavGroup[] {
  return [
    {
      label: 'Konto',
      items: [{ href: '/konto', label: 'Profil', icon: UserRound }],
    },
    {
      label: 'Anbieten',
      items: [
        { href: '/konto/anzeigen', label: 'Meine Anzeigen', icon: LayoutList },
        // Nur für gewerbliche Konten
        ...(showDeals ? [{ href: '/konto/deals', label: 'Deals', icon: Tag }] : []),
        { href: '/konto/dienstleistungen', label: 'Meine Dienstleistungen', icon: Wrench },
        { href: '/konto/projekte', label: 'Meine Aufträge', icon: BriefcaseBusiness },
        { href: '/konto/leistungen', label: 'Mehr Sichtbarkeit', icon: Sparkles },
      ],
    },
    {
      label: 'Kontakt & Merken',
      items: [
        { href: '/nachrichten', label: 'Nachrichten', icon: MessageCircle, count: unreadMessages, countLabel: 'ungelesen' },
        { href: '/konto/bewertungen', label: 'Bewertungen', icon: Star },
        { href: '/konto/merkliste', label: 'Merkliste', icon: Heart },
        { href: '/konto/suchen', label: 'Gespeicherte Suchen', icon: Bookmark },
      ],
    },
    {
      label: 'Einstellungen',
      items: [
        { href: '/konto/benachrichtigungen', label: 'Benachrichtigungen', icon: Bell },
        { href: '/konto/mitteilungen', label: 'Mitteilungen', icon: Inbox },
        { href: '/konto/sicherheit', label: 'Sicherheit', icon: ShieldCheck },
        { href: '/konto/datenschutz', label: 'Datenschutz', icon: LockKeyhole },
      ],
    },
  ];
}

/** Navigation im Kontobereich; „Nachrichten“ zeigt die Zahl ungelesener Nachrichten live. */
export function AccountNav({ showDeals = false }: { showDeals?: boolean }) {
  const pathname = usePathname();
  const unread = useUnread();
  const groups = buildGroups({ unreadMessages: unread?.messages ?? 0, showDeals });
  const hrefs = groups.flatMap((g) => g.items.map((item) => item.href));
  const lookup = Object.entries(ALIASES).find(([from]) => pathname === from || pathname.startsWith(`${from}/`))?.[1] ?? pathname;
  const activeHref = findActiveHref(lookup, hrefs, '/konto');
  return (
    <div className="space-y-3">
      <QuickLinks activeHref={activeHref} unreadMessages={unread?.messages ?? 0} />
      <SectionNav label="Kontobereich" groups={groups} activeHref={activeHref} />
    </div>
  );
}

const QUICK_LINKS = [
  { href: '/konto/anzeigen', label: 'Anzeigen', icon: LayoutList },
  { href: '/nachrichten', label: 'Nachrichten', icon: MessageCircle },
  { href: '/konto/merkliste', label: 'Merkliste', icon: Heart },
  { href: '/konto/suchen', label: 'Suchen', icon: Bookmark },
];

/**
 * Handy und Tablet: die vier meistgebrauchten Bereiche direkt sichtbar, ohne erst das Menü aufzuklappen
 * (im Nutzertest war die Merkliste sonst vier Schritte entfernt). Ab `lg` steht alles in der Seitenleiste.
 */
function QuickLinks({ activeHref, unreadMessages }: { activeHref: string | null; unreadMessages: number }) {
  return (
    <ul className="grid grid-cols-4 gap-2 lg:hidden" aria-label="Schnellzugriff">
      {QUICK_LINKS.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === activeHref;
        const count = item.href === '/nachrichten' ? unreadMessages : 0;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-xs font-semibold press',
                isActive ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink-700 shadow-[var(--shadow-card)]',
              )}
            >
              <Icon className={cn('size-5', isActive ? 'text-brand-700' : 'text-ink-500')} aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
              {count ? (
                <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[0.6875rem] font-bold text-on-accent tabular-nums">
                  <span className="sr-only">ungelesen: </span>
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Ohne aktiven Eintrag – Platzhalter, solange der Pfad bei dynamischen Seiten noch nicht feststeht */
export function AccountNavFallback() {
  return (
    <div className="space-y-3">
      <QuickLinks activeHref={null} unreadMessages={0} />
      <SectionNav label="Kontobereich" groups={buildGroups({ unreadMessages: 0, showDeals: false })} activeHref={null} />
    </div>
  );
}
