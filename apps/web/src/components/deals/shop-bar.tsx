import Link from 'next/link';
import { cn } from '@marktat/ui';
import { dealSearchHref, type DealFacetValue, type DealSearchQuery } from '@marktat/shared';

/**
 * Schnellwahl der Shops über den Angeboten: „Alle Shops“ und jeder Shop mit Anzahl passender Angebote.
 * Smartphone: seitlich wischbare Leiste (overflow-y-hidden, sonst federt sie auf iOS auch nach oben und unten).
 */
export function ShopBar({ query, shops }: { query: DealSearchQuery; shops: DealFacetValue[] }) {
  const selected = query.shop?.toLocaleLowerCase('de');
  const entries =
    selected && !shops.some((s) => s.value.toLocaleLowerCase('de') === selected)
      ? [{ value: query.shop!, count: 0 }, ...shops]
      : shops;
  // Bei nur einem Shop und ohne Auswahl gibt es nichts zu wählen
  if (entries.length < 2 && !query.shop) return null;
  const total = shops.reduce((sum, s) => sum + s.count, 0);
  return (
    <nav aria-label="Shops" className="mt-4">
      <ul className="relative -mx-4 flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <li className="flex shrink-0">
          <ShopLink
            href={dealSearchHref({ ...query, shop: undefined, page: 1 })}
            active={!query.shop}
            label="Alle Shops"
            count={query.shop ? undefined : total}
          />
        </li>
        {entries.map((shop) => (
          <li key={shop.value} className="flex shrink-0">
            <ShopLink
              href={dealSearchHref({ ...query, shop: shop.value, page: 1 })}
              active={shop.value.toLocaleLowerCase('de') === selected}
              label={shop.value}
              count={shop.count || undefined}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ShopLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number | undefined;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap press',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-line bg-surface text-ink-800 hover:border-brand-300 hover:bg-brand-50',
      )}
    >
      {label}
      {count !== undefined ? (
        <span className={cn('text-xs tabular-nums', active ? 'text-white/80' : 'text-ink-500')}>
          {count.toLocaleString('de-AT')}
        </span>
      ) : null}
    </Link>
  );
}
