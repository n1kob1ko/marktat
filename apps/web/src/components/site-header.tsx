import Link from 'next/link';
import { Suspense } from 'react';
import { Plus, Search } from 'lucide-react';
import { buttonClasses, Container, Skeleton } from '@marktat/ui';
import { Logo } from './logo';
import { UserMenu } from './user-menu';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <Container className="flex h-16 items-center gap-2 sm:gap-6">
        <Link href="/" className="shrink-0 rounded-lg" aria-label="MarktAT – zur Startseite">
          {/* Sehr schmale Handys (320–400 px): nur das Bildzeichen, damit „Inserieren“ Platz hat */}
          <Logo wordmarkClassName="max-[400px]:sr-only" />
        </Link>

        <form action="/suche" role="search" className="hidden flex-1 md:block">
          <label htmlFor="header-search" className="sr-only">
            Anzeigen durchsuchen
          </label>
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              id="header-search"
              name="q"
              type="search"
              placeholder="Was suchst du?"
              className="h-11 w-full rounded-xl border border-line-strong bg-canvas pr-4 pl-10 text-[0.9375rem] placeholder:text-ink-400 focus:border-brand-500 focus:bg-surface focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
        </form>

        <nav aria-label="Konto" className="ml-auto flex items-center gap-1 sm:gap-2">
          <Suspense fallback={<Skeleton className="h-9 w-24" />}>
            <UserMenu />
          </Suspense>
          <Link href="/inserieren" className={buttonClasses({ variant: 'accent', size: 'sm', className: 'h-10 px-3 sm:px-4' })}>
            <Plus className="size-4.5" aria-hidden="true" />
            <span className="hidden sm:inline">Inserat aufgeben</span>
            <span className="sm:hidden">Inserieren</span>
          </Link>
        </nav>
      </Container>
    </header>
  );
}
