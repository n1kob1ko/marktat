'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@marktat/ui';

const NAV = [
  { href: '/admin', label: 'Übersicht', adminOnly: false },
  { href: '/admin/meldungen', label: 'Meldungen', adminOnly: false },
  { href: '/admin/inserate', label: 'Inserate', adminOnly: false },
  { href: '/admin/deals', label: 'Deals', adminOnly: false },
  { href: '/admin/dienstleistungen', label: 'Dienstleistungen', adminOnly: false },
  { href: '/admin/einsprueche', label: 'Einsprüche', adminOnly: false },
  { href: '/admin/nutzer', label: 'Konten', adminOnly: true },
  { href: '/admin/monetarisierung', label: 'Monetarisierung', adminOnly: true },
  { href: '/admin/protokoll', label: 'Protokoll', adminOnly: true },
  { href: '/admin/system', label: 'System', adminOnly: true },
];

/** Reiter im Admin-Bereich. Konten, Monetarisierung, Protokoll und Systemzustand sehen nur Administratoren. */
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin-Bereich" className="-mx-4 mt-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap sm:px-4',
                  active ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-600 hover:border-line-strong hover:text-ink-900',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
