'use client';

import { usePathname } from 'next/navigation';
import {
  Activity,
  BriefcaseBusiness,
  Coins,
  Flag,
  Gauge,
  Handshake,
  LayoutList,
  Scale,
  ScrollText,
  Tag,
  Users,
  Wrench,
} from 'lucide-react';
import { findActiveHref, SectionNav, type SectionNavGroup } from '../section-nav';

function buildGroups(isAdmin: boolean): SectionNavGroup[] {
  const groups: SectionNavGroup[] = [
    {
      label: 'Moderation',
      items: [
        { href: '/admin', label: 'Übersicht', icon: Gauge },
        { href: '/admin/meldungen', label: 'Meldungen', icon: Flag },
        { href: '/admin/inserate', label: 'Inserate', icon: LayoutList },
        { href: '/admin/einsprueche', label: 'Einsprüche', icon: Scale },
      ],
    },
    {
      label: 'Inhalte',
      items: [
        { href: '/admin/deals', label: 'Deals', icon: Tag },
        { href: '/admin/affiliate', label: 'Affiliate', icon: Handshake },
        { href: '/admin/dienstleistungen', label: 'Dienstleistungen', icon: Wrench },
        { href: '/admin/dienstleistungen/projekte', label: 'Projektaufträge', icon: BriefcaseBusiness },
      ],
    },
  ];
  // Konten, Monetarisierung, Protokoll und Systemzustand sehen nur Administratoren
  if (isAdmin) {
    groups.push({
      label: 'Verwaltung',
      items: [
        { href: '/admin/nutzer', label: 'Konten', icon: Users },
        { href: '/admin/monetarisierung', label: 'Monetarisierung', icon: Coins },
        { href: '/admin/protokoll', label: 'Protokoll', icon: ScrollText },
        { href: '/admin/system', label: 'System', icon: Activity },
      ],
    });
  }
  return groups;
}

/** Navigation im Moderations- und Admin-Bereich. */
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const groups = buildGroups(isAdmin);
  const hrefs = groups.flatMap((g) => g.items.map((item) => item.href));
  return <SectionNav label="Admin-Bereich" groups={groups} activeHref={findActiveHref(pathname, hrefs, '/admin')} />;
}
