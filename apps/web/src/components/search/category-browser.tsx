import Image from 'next/image';
import Link from 'next/link';
import { hasActiveFilters, type CategoryNode, type SearchQuery } from '@marktat/shared';
import { cn } from '@marktat/ui';
import { CategoryIcon } from '@/components/category-icon';
import { CategoryPhotoTile } from '@/components/category-photo-tile';
import { CATEGORY_PHOTOS, categoryPhotoUrl, type CategoryPhoto } from '@/content/category-photos';
import { browseChildren, currentScope, scopeHref, type BrowseEntry } from '@/lib/search';

/** Icons der Bereiche, wenn noch kein Bereich gewählt ist */
const VERTICAL_ICONS: Record<string, string> = { marktplatz: 'shopping-bag', 'auto-motor': 'car', immobilien: 'house', jobs: 'briefcase' };

/** Bis zu so vielen Einträgen passen Fotokacheln in eine Zeile; bei mehr wird es eine Liste mit kleinen Vorschaubildern */
const MAX_TILES = 6;

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

  const photos = entries.map((entry) => CATEGORY_PHOTOS[entry.key]);
  if (entries.length <= MAX_TILES && photos.every(Boolean)) {
    return (
      <nav aria-label={title} className="mt-5">
        <h2 className="sr-only">{title}</h2>
        <ul
          className={cn(
            // relative: unsichtbare Texte (sr-only, absolut positioniert) bleiben in der Leiste, sonst wird die Seite breit
            // Smartphone: wischbare Leiste mit quadratischen Kacheln, ab Tablet alle nebeneinander in einer Zeile
            'relative -mx-4 flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'sm:mx-0 sm:grid sm:auto-cols-fr sm:grid-flow-col sm:gap-3 sm:overflow-visible sm:px-0',
          )}
        >
          {entries.map((entry, i) => (
            <li key={entry.key} className="w-28 shrink-0 sm:w-auto">
              <CategoryPhotoTile
                href={scopeHref(query, entry.scope)}
                name={entry.label}
                count={counts?.[entry.key]}
                photo={photos[i]}
                icon={null}
                sizes="(min-width: 1024px) 11rem, (min-width: 640px) 20vw, 7rem"
                className="aspect-square sm:aspect-[4/3]"
              />
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={title} className="mt-5">
      <h2 className="sr-only">{title}</h2>
      <ul
        className={cn(
          // relative: unsichtbare Texte (sr-only, absolut positioniert) bleiben in der Leiste, sonst wird die Seite breit
          // Smartphone: seitlich wischbare Leiste, damit die Anzeigen nicht weit nach unten rutschen
          'relative -mx-4 flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:gap-y-0.5 sm:overflow-visible sm:rounded-[var(--radius-card)] sm:border sm:border-line sm:bg-surface sm:p-2 xl:grid-cols-3',
        )}
      >
        {entries.map((entry, i) => (
          <li key={entry.key} className="flex shrink-0">
            <EntryLink entry={entry} href={scopeHref(query, entry.scope)} count={counts?.[entry.key]} photo={photos[i]} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function EntryLink({ entry, href, count, photo }: { entry: BrowseEntry; href: string; count: number | undefined; photo: CategoryPhoto | undefined }) {
  const icon = entry.icon ?? VERTICAL_ICONS[entry.key] ?? null;
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex w-full min-w-0 items-center gap-2.5 text-sm transition-colors tap',
        'rounded-full border border-line bg-surface px-3.5 py-2 hover:border-brand-300 hover:bg-brand-50',
        'sm:rounded-lg sm:border-transparent sm:bg-transparent sm:px-2.5',
      )}
    >
      {photo ? (
        <Image
          src={categoryPhotoUrl(photo, 160)}
          alt=""
          width={32}
          height={32}
          className="-ml-2 size-6 shrink-0 rounded-full object-cover sm:ml-0 sm:size-8 sm:rounded-lg"
          style={{ backgroundColor: photo.color }}
        />
      ) : icon ? (
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-surface sm:flex">
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
