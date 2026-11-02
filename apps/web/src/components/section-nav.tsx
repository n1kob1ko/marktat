'use client';

import Link from 'next/link';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@marktat/ui';

export type SectionNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Zahl neben dem Eintrag, z. B. ungelesene Nachrichten; 0 blendet sie aus */
  count?: number;
  /** Beschriftung der Zahl für Screenreader, z. B. „ungelesen“ */
  countLabel?: string;
};

export type SectionNavGroup = { label: string; items: SectionNavItem[] };

/**
 * Bereichsnavigation für Konto und Moderation.
 * Ab `lg` eine Seitenleiste mit Gruppen, darunter ein aufklappbares Menü, das den aktuellen Bereich zeigt.
 * So bleiben alle Einträge sichtbar, ohne waagrechten Scrollbalken.
 */
export function SectionNav({
  label,
  groups,
  activeHref,
}: {
  label: string;
  groups: SectionNavGroup[];
  /** href des aktiven Eintrags; null, solange er noch nicht feststeht */
  activeHref: string | null;
}) {
  const active = groups.flatMap((g) => g.items).find((item) => item.href === activeHref);
  const pendingCount = groups.flatMap((g) => g.items).reduce((sum, item) => sum + (item.count ?? 0), 0);
  const ActiveIcon = active?.icon;

  return (
    <nav aria-label={label}>
      {/* Handy und Tablet: aufklappbar. key setzt den Zustand nach jedem Seitenwechsel zurück (Menü wieder zu). */}
      <details key={activeHref ?? ''} className="group rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
          {ActiveIcon ? <ActiveIcon className="size-[1.125rem] shrink-0 text-brand-700" aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 truncate">{active?.label ?? label}</span>
          {pendingCount ? (
            <>
              <span className="sr-only">, neue Einträge: </span>
              <CountBubble count={pendingCount} />
            </>
          ) : null}
          <span className="text-xs font-medium text-ink-500">Bereich wechseln</span>
          <ChevronDown className="size-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-x-4 gap-y-4 border-t border-line px-2 py-3 sm:grid-cols-2">
          {groups.map((group) => (
            <NavGroup key={group.label} group={group} activeHref={activeHref} />
          ))}
        </div>
      </details>

      {/* Desktop: Seitenleiste; bleibt auf ausreichend hohen Bildschirmen beim Scrollen stehen (unter der Kopfzeile) */}
      <div className="hidden space-y-5 lg:block [@media(min-height:50rem)]:sticky [@media(min-height:50rem)]:top-32">
        {groups.map((group) => (
          <NavGroup key={group.label} group={group} activeHref={activeHref} />
        ))}
      </div>
    </nav>
  );
}

function NavGroup({ group, activeHref }: { group: SectionNavGroup; activeHref: string | null }) {
  return (
    <div>
      <p className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">{group.label}</p>
      <ul className="space-y-0.5">
        {group.items.map((item) => {
          const isActive = item.href === activeHref;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-brand-50 font-semibold text-brand-800' : 'font-medium text-ink-700 hover:bg-ink-900/5 hover:text-ink-950',
                )}
              >
                <Icon className={cn('size-[1.125rem] shrink-0', isActive ? 'text-brand-700' : 'text-ink-400')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.count ? (
                  <>
                    <span className="sr-only">, {item.countLabel ?? 'Anzahl'}: </span>
                    <CountBubble count={item.count} />
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CountBubble({ count }: { count: number }) {
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[0.6875rem] font-bold text-on-accent">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Der genaueste passende Eintrag gewinnt (/admin/dienstleistungen/projekte vor /admin/dienstleistungen). */
export function findActiveHref(pathname: string | null, hrefs: string[], rootHref: string): string | null {
  if (pathname === null) return null;
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = href === rootHref ? pathname === rootHref : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
