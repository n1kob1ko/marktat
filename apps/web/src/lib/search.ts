/**
 * Hilfen für die Suchseite (Server und Browser): Kategorien nachschlagen, Links bauen, aktive Filter beschreiben.
 * Die Filter selbst kommen aus @marktat/shared – dieselben Definitionen wie in der API.
 */
import {
  CONDITION_PARAMS,
  ITEM_CONDITION_LABELS,
  SELLER_TYPES,
  STATES,
  VERTICAL_LABELS,
  formatPriceCents,
  isCategoryPath,
  toSearchParams,
  type CategoryNode,
  type LocationSummary,
  type SearchFilter,
  type SearchQuery,
} from '@marktat/shared';

export interface FlatCategory {
  node: CategoryNode;
  depth: number;
  /** Namen von oben nach unten, z. B. ["Sport & Freizeit", "Fahrräder"] */
  trail: string[];
}

export function flattenCategories(tree: CategoryNode[], depth = 0, trail: string[] = []): FlatCategory[] {
  return tree.flatMap((node) => [
    { node, depth, trail: [...trail, node.name] },
    ...flattenCategories(node.children, depth + 1, [...trail, node.name]),
  ]);
}

export function findCategoryByPath(tree: CategoryNode[], path: string): CategoryNode | undefined {
  return flattenCategories(tree).find((c) => c.node.path === path)?.node;
}

export function searchHref(query: SearchQuery, filters: readonly SearchFilter[]): string {
  const params = new URLSearchParams(toSearchParams(query, filters));
  const text = params.toString();
  return text ? `/suche?${text}` : '/suche';
}

const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

function rangeText(min: number | undefined, max: number | undefined, format: (n: number) => string) {
  if (min !== undefined && max !== undefined) return min === max ? format(min) : `${format(min)} – ${format(max)}`;
  if (min !== undefined) return `ab ${format(min)}`;
  return `bis ${format(max!)}`;
}

const euro = (n: number) => formatPriceCents(Math.round(n * 100));

export function formatFilterNumber(filter: SearchFilter, n: number) {
  if (filter.kind === 'range' && filter.euro) return euro(n);
  const unit = filter.kind === 'range' && filter.unit ? ` ${filter.unit}` : '';
  // Jahreszahlen ohne Tausenderpunkt
  return `${filter.kind === 'range' && filter.year ? String(n) : numberFormat.format(n)}${unit}`;
}

export interface ActiveFilter {
  /** eindeutiger Schlüssel (für React) */
  id: string;
  label: string;
  /** Link zur Suche ohne diesen Filter */
  removeHref: string;
}

/**
 * Aktive Filter als entfernbare „Chips“. Jeder Eintrag verlinkt auf dieselbe Suche ohne diesen Filter.
 * Der Suchbegriff gehört nicht dazu – er steht im Suchfeld.
 */
export function activeFilters(
  query: SearchQuery,
  filters: readonly SearchFilter[],
  context: { category?: CategoryNode; location?: LocationSummary | null },
): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  const without = (change: (q: SearchQuery) => void, keepFilters = true) => {
    const next: SearchQuery = structuredClone(query);
    change(next);
    next.page = 1;
    return searchHref(next, keepFilters ? filters : []);
  };

  if (query.category && isCategoryPath(query.category)) {
    chips.push({
      id: 'kategorie',
      label: context.category?.name ?? 'Kategorie',
      // Ohne Kategorie gelten deren Eigenschaftsfilter nicht mehr
      removeHref: without((q) => {
        delete q.category;
        q.attributes = {};
      }, false),
    });
  } else if (query.vertical) {
    chips.push({
      id: 'bereich',
      label: VERTICAL_LABELS[query.vertical],
      removeHref: without((q) => {
        delete q.vertical;
        q.attributes = {};
      }, false),
    });
  }
  if (query.locationId || query.postalCode) {
    const name = context.location ? `${context.location.postalCode} ${context.location.place}` : (query.postalCode ?? 'Ort');
    chips.push({
      id: 'ort',
      label: query.radiusKm ? `${name} + ${query.radiusKm} km` : name,
      removeHref: without((q) => {
        delete q.locationId;
        delete q.postalCode;
        delete q.radiusKm;
        if (q.sort === 'entfernung') q.sort = q.q ? 'relevanz' : 'neueste';
      }),
    });
  }
  if (query.state) {
    chips.push({
      id: 'bundesland',
      label: STATES.find((s) => s.slug === query.state)?.name ?? query.state,
      removeHref: without((q) => delete q.state),
    });
  }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    chips.push({
      id: 'preis',
      label: `Preis ${rangeText(query.priceMin, query.priceMax, euro)}`,
      removeHref: without((q) => {
        delete q.priceMin;
        delete q.priceMax;
      }),
    });
  }
  if (query.seller) {
    chips.push({ id: 'anbieter', label: SELLER_TYPES[query.seller], removeHref: without((q) => delete q.seller) });
  }
  for (const condition of query.conditions ?? []) {
    chips.push({
      id: `zustand-${CONDITION_PARAMS[condition]}`,
      label: `Zustand: ${ITEM_CONDITION_LABELS[condition]}`,
      removeHref: without((q) => {
        q.conditions = q.conditions?.filter((c) => c !== condition);
      }),
    });
  }
  for (const filter of filters) {
    const value = query.attributes[filter.key];
    if (!value) continue;
    const drop = (change: (v: NonNullable<typeof value>) => void) =>
      without((q) => {
        const current = q.attributes[filter.key]!;
        change(current);
        const empty = !current.values?.length && current.min === undefined && current.max === undefined && !current.words?.length && !current.flag;
        if (empty) delete q.attributes[filter.key];
      });
    if (filter.kind === 'options') {
      for (const v of value.values ?? []) {
        const option = filter.options.find((o) => o.value === v);
        chips.push({
          id: `${filter.param}-${v}`,
          label: `${filter.label}: ${option?.label ?? v}`,
          removeHref: drop((current) => {
            current.values = current.values?.filter((x) => x !== v);
          }),
        });
      }
    } else if (filter.kind === 'range') {
      chips.push({
        id: filter.param,
        label: `${filter.label}: ${rangeText(value.min, value.max, (n) => formatFilterNumber(filter, n))}`,
        removeHref: drop((current) => {
          delete current.min;
          delete current.max;
        }),
      });
    } else if (filter.kind === 'words') {
      chips.push({
        id: filter.param,
        label: `${filter.label}: ${value.words?.join(' ')}`,
        removeHref: drop((current) => delete current.words),
      });
    } else if (value.flag) {
      chips.push({ id: filter.param, label: filter.label, removeHref: drop((current) => delete current.flag) });
    }
  }
  return chips;
}

/** Link „alle Filter zurücksetzen“: nur der Suchbegriff bleibt. */
export function resetHref(query: SearchQuery) {
  return query.q ? `/suche?${new URLSearchParams({ q: query.q })}` : '/suche';
}

export function scopeLabel(query: SearchQuery, category?: CategoryNode) {
  if (category) return category.name;
  if (query.vertical) return VERTICAL_LABELS[query.vertical];
  return null;
}

