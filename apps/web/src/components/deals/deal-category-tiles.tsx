import { dealSearchHref, type DealCategoryView, type DealSearchQuery } from '@marktat/shared';
import { cn } from '@marktat/ui';
import { CategoryIcon } from '@/components/category-icon';
import { CategoryPhotoTile } from '@/components/category-photo-tile';
import { dealCategoryPhoto } from '@/content/category-photos';

/**
 * Kategorien der Deals als Fotokacheln über den Angeboten, jeweils mit der Zahl passender Angebote
 * (nur Kategorien mit Treffern, meiste zuerst). Erscheint nur, solange keine Kategorie gewählt ist; andere Filter bleiben beim Wechsel erhalten.
 * Wischbare Leiste (overflow-y-hidden, sonst federt sie auf iOS auch nach oben und unten).
 */
export function DealCategoryTiles({
  query,
  categories,
  counts,
}: {
  query: DealSearchQuery;
  categories: DealCategoryView[];
  counts: Record<string, number>;
}) {
  if (query.category) return null;
  const entries = categories
    .filter((category) => (counts[category.slug] ?? 0) > 0)
    .sort((a, b) => counts[b.slug]! - counts[a.slug]!);
  if (entries.length < 2) return null;
  return (
    <nav aria-label="Kategorien" className="mt-4">
      <h2 className="sr-only">Kategorien</h2>
      <ul
        className={cn(
          // relative: unsichtbare Texte (sr-only, absolut positioniert) bleiben in der Leiste, sonst wird die Seite breit
          'relative -mx-4 flex snap-x gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:gap-3 sm:px-0 sm:[scrollbar-width:thin] [&::-webkit-scrollbar]:hidden sm:[&::-webkit-scrollbar]:block',
        )}
      >
        {entries.map((category) => (
          <li key={category.slug} className="w-28 shrink-0 snap-start sm:w-40">
            <CategoryPhotoTile
              href={dealSearchHref({ ...query, category: category.slug, page: 1 })}
              name={category.name}
              count={counts[category.slug]}
              unit={['Angebot', 'Angebote']}
              photo={dealCategoryPhoto(category.slug, category.relatedCategoryPath)}
              icon={<CategoryIcon name={category.icon} className="size-8" />}
              sizes="(min-width: 640px) 10rem, 7rem"
              className="aspect-square sm:aspect-[4/3]"
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
