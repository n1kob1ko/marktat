import { Search } from 'lucide-react';
import { STATES } from '@marktat/shared';

const QUICK_SEARCHES = ['Fahrrad', 'Sofa', 'Kinderwagen', 'iPhone', 'Ski', 'Waschmaschine'];

/** Große Suchleiste der Startseite. Funktioniert ohne JavaScript (GET-Formular auf /suche). */
export function SearchHero() {
  return (
    <form action="/suche" role="search" className="w-full">
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-2 shadow-[0_24px_48px_-24px_rgb(7_42_32/0.6)] sm:flex-row sm:items-center">
        <label htmlFor="hero-q" className="sr-only">
          Suchbegriff
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            id="hero-q"
            name="q"
            type="search"
            placeholder="Was suchst du? z. B. Rennrad, Esstisch, E-Gitarre"
            className="h-13 w-full rounded-xl border-0 bg-transparent pr-3 pl-12 text-base text-ink-900 placeholder:text-ink-400 focus:ring-3 focus:ring-brand-500/25 focus:outline-none"
          />
        </div>
        <div className="hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
        <label htmlFor="hero-state" className="sr-only">
          Bundesland
        </label>
        <select
          id="hero-state"
          name="bundesland"
          defaultValue=""
          className="select-chevron h-13 rounded-xl border-0 bg-canvas px-4 text-[0.9375rem] font-medium text-ink-700 focus:ring-3 focus:ring-brand-500/25 focus:outline-none sm:w-48 sm:bg-transparent"
        >
          <option value="">Ganz Österreich</option>
          {STATES.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-13 rounded-xl bg-accent-500 px-7 text-base font-semibold text-ink-950 transition-colors hover:bg-accent-600 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Suchen
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-brand-100">Beliebt:</span>
        {QUICK_SEARCHES.map((term) => (
          <a
            key={term}
            href={`/suche?q=${encodeURIComponent(term)}`}
            className="rounded-full border border-white/20 px-3 py-1 text-white/90 transition-colors hover:border-white/50 hover:bg-white/10"
          >
            {term}
          </a>
        ))}
      </div>
    </form>
  );
}
