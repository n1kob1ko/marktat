'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Briefcase, Car, House, Percent, ShoppingBag, Wrench, type LucideIcon } from 'lucide-react';
import { Container, cn } from '@marktat/ui';
import { VERTICAL_LABELS, VERTICAL_SLUGS } from '@marktat/shared';

interface Area {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Die sechs Bereiche: vier Kleinanzeigen-Bereiche (Suche mit `bereich`), Deals und Dienstleistungen */
export const AREAS: Area[] = [
  { id: VERTICAL_SLUGS.MARKETPLACE, label: VERTICAL_LABELS.MARKETPLACE, href: `/suche?bereich=${VERTICAL_SLUGS.MARKETPLACE}`, icon: ShoppingBag },
  { id: VERTICAL_SLUGS.VEHICLES, label: VERTICAL_LABELS.VEHICLES, href: `/suche?bereich=${VERTICAL_SLUGS.VEHICLES}`, icon: Car },
  { id: VERTICAL_SLUGS.REAL_ESTATE, label: VERTICAL_LABELS.REAL_ESTATE, href: `/suche?bereich=${VERTICAL_SLUGS.REAL_ESTATE}`, icon: House },
  { id: VERTICAL_SLUGS.JOBS, label: VERTICAL_LABELS.JOBS, href: `/suche?bereich=${VERTICAL_SLUGS.JOBS}`, icon: Briefcase },
  { id: 'deals', label: 'Deals', href: '/deals', icon: Percent },
  { id: 'dienstleistungen', label: 'Dienstleistungen', href: '/dienstleistungen', icon: Wrench },
];

/** Welcher Bereich zur aktuellen Adresse gehört; Inserat-Detailseiten u. Ä. gehören zu keinem */
export function activeArea(pathname: string, params: URLSearchParams): string | null {
  if (pathname === '/deals' || pathname.startsWith('/deals/')) return 'deals';
  if (pathname === '/dienstleistungen' || pathname.startsWith('/dienstleistungen/')) return 'dienstleistungen';
  if (pathname === '/suche') {
    const area = params.get('bereich') ?? params.get('kategorie')?.split('/')[0] ?? null;
    return AREAS.some((a) => a.id === area) ? area : null;
  }
  return null;
}

/** Bereichsleiste unter dem Kopf. Auf dem Smartphone seitlich wischbar, jeder Eintrag mindestens 44 px hoch. */
export function AreaNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  return <AreaNavList active={activeArea(pathname, new URLSearchParams(params.toString()))} />;
}

/** Ohne aktiven Bereich – Platzhalter, solange die Adresse beim Vorrendern noch nicht feststeht */
export function AreaNavList({ active }: { active: string | null }) {
  return (
    <nav aria-label="Bereiche" className="border-b border-line bg-surface">
      <Container className="px-0 sm:px-6">
        <ul className="flex h-11 items-stretch gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden">
          {AREAS.map((area) => {
            const current = area.id === active;
            return (
              <li key={area.id} className="flex shrink-0">
                <Link
                  href={area.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold whitespace-nowrap sm:px-3',
                    current ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-600 hover:border-line-strong hover:text-ink-900',
                  )}
                >
                  <area.icon className="size-4 shrink-0" aria-hidden="true" />
                  {area.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>
    </nav>
  );
}
