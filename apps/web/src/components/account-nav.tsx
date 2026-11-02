'use client';

import { usePathname } from 'next/navigation';
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

function buildGroups({ unreadMessages, showSecurity, showDeals }: { unreadMessages: number; showSecurity: boolean; showDeals: boolean }): SectionNavGroup[] {
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
        { href: '/konto/dienstleistungen', label: 'Dienstleistungen', icon: Wrench },
        { href: '/konto/projekte', label: 'Projektaufträge', icon: BriefcaseBusiness },
        { href: '/konto/leistungen', label: 'Leistungen', icon: Sparkles },
      ],
    },
    {
      label: 'Kontakt & Merken',
      items: [
        { href: '/nachrichten', label: 'Nachrichten', icon: MessageCircle, count: unreadMessages, countLabel: 'ungelesen' },
        { href: '/konto/merkliste', label: 'Merkliste', icon: Heart },
        { href: '/konto/suchen', label: 'Gespeicherte Suchen', icon: Bookmark },
      ],
    },
    {
      label: 'Einstellungen',
      items: [
        { href: '/konto/benachrichtigungen', label: 'Benachrichtigungen', icon: Bell },
        { href: '/konto/mitteilungen', label: 'Mitteilungen', icon: Inbox },
        // Nur für Moderation und Administration: Zwei-Faktor-Anmeldung
        ...(showSecurity ? [{ href: '/konto/sicherheit', label: 'Sicherheit', icon: ShieldCheck }] : []),
        { href: '/konto/datenschutz', label: 'Datenschutz', icon: LockKeyhole },
      ],
    },
  ];
}

/** Navigation im Kontobereich; „Nachrichten“ zeigt die Zahl ungelesener Nachrichten live. */
export function AccountNav({ showSecurity = false, showDeals = false }: { showSecurity?: boolean; showDeals?: boolean }) {
  const pathname = usePathname();
  const unread = useUnread();
  const groups = buildGroups({ unreadMessages: unread?.messages ?? 0, showSecurity, showDeals });
  const hrefs = groups.flatMap((g) => g.items.map((item) => item.href));
  const lookup = Object.entries(ALIASES).find(([from]) => pathname === from || pathname.startsWith(`${from}/`))?.[1] ?? pathname;
  return <SectionNav label="Kontobereich" groups={groups} activeHref={findActiveHref(lookup, hrefs, '/konto')} />;
}

/** Ohne aktiven Eintrag – Platzhalter, solange der Pfad bei dynamischen Seiten noch nicht feststeht */
export function AccountNavFallback() {
  return <SectionNav label="Kontobereich" groups={buildGroups({ unreadMessages: 0, showSecurity: false, showDeals: false })} activeHref={null} />;
}
