import Link from 'next/link';
import { hasActiveFilters, type CategoryNode, type SearchQuery } from '@marktat/shared';
import { cn } from '@marktat/ui';
import { CategoryIcon } from '@/components/category-icon';
import { browseChildren, currentScope, scopeHref, type BrowseEntry } from '@/lib/search';

/** Icons der Bereiche, wenn noch kein Bereich gewählt ist */
const VERTICAL_ICONS: Record<string, string> = { marktplatz: 'shopping-bag', 'auto-motor': 'car', immobilien: 'house', jobs: 'briefcase' };

/**
 * Nächste Ebene der Kategorien über den Ergebnissen, jeweils mit der Zahl passender Anzeigen
 * (Alle Bereiche → Marktplatz → Elektronik → Handys & Smartphones). Ohne Filter erscheinen alle
 * Unterkategorien, mit Suchbegriff oder Filtern nur die mit Treffern. Filter bleiben beim Wechsel erhalten.
 */
export function CategoryBrowser({
  query,
  categories,
  counts,
  label,
}: {
  query: SearchQuery;
  categories: CategoryNode[];
  counts: Record<string, number> | undefined;
  /** Name des aktuellen Bereichs bzw. der Kategorie */
  label: string | null;
}) {
  const scope = currentScope(query);
  const filtered = hasActiveFilters({ ...query, vertical: undefined, category: undefined });
  const entries = browseChildren(categories, scope).filter((entry) => !filtered || (counts?.[entry.key] ?? 0) > 0);
  if (!entries.length) return null;
  const title = scope ? `Unterkategorien${label ? ` in ${label}` : ''}` : 'Alle Bereiche';

  return (
    <nav aria-label={title} className="mt-5">
      <h2 className="sr-only">{title}</h2>
      <ul
        className={cn(
          // Smartphone: seitlich wischbare Leiste, damit die Anzeigen nicht weit nach unten rutschen
          '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-0.5 sm:overflow-visible sm:rounded-[var(--radius-card)] sm:border sm:border-line sm:bg-surface sm:p-2 xl:grid-cols-3',
        )}
      >
        {entries.map((entry) => (
          <li key={entry.key} className="flex shrink-0">
            <EntryLink entry={entry} href={scopeHref(query, entry.scope)} count={counts?.[entry.key]} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function EntryLink({ entry, href, count }: { entry: BrowseEntry; href: string; count: number | undefined }) {
  const icon = entry.icon ?? VERTICAL_ICONS[entry.key] ?? null;
  return (
    <Link
      href={href}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2.5 text-sm transition-colors',
        'rounded-full border border-line bg-surface px-3.5 py-2 hover:border-brand-300 hover:bg-brand-50',
        'sm:rounded-lg sm:border-transparent sm:bg-transparent sm:px-2.5',
      )}
    >
      {icon ? (
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-white sm:flex">
          <CategoryIcon name={icon} className="size-4" />
        </span>
      ) : null}
      <span className="font-medium whitespace-nowrap text-ink-900 group-hover:text-brand-800 sm:min-w-0 sm:truncate">{entry.label}</span>
      {count ? (
        <span className="shrink-0 text-xs text-ink-500 tabular-nums">
          {count.toLocaleString('de-AT')}
          <span className="sr-only"> {count === 1 ? 'Anzeige' : 'Anzeigen'}</span>
        </span>
      ) : null}
    </Link>
  );
}
