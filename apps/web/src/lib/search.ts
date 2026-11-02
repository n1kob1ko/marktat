/**
 * Hilfen für die Suchseite (Server und Browser): Kategorien nachschlagen, Links bauen, aktive Filter beschreiben.
 * Die Filter selbst kommen aus @marktat/shared – dieselben Definitionen wie in der API.
 */
import {
  CONDITION_PARAMS,
  ITEM_CONDITION_LABELS,
  SELLER_TYPES,
  STATES,
  VERTICALS,
  VERTICAL_LABELS,
  VERTICAL_SLUGS,
  formatPriceCents,
  hasItemCondition,
  hasPrice,
  isCategoryPath,
  searchFiltersFor,
  toSearchParams,
  type CategoryNode,
  type LocationSummary,
  type SearchFilter,
  type SearchQuery,
  type Vertical,
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

/** Wohin die Kategorienavigation führt: alle Bereiche, ein Bereich oder eine Kategorie (Pfad) */
export type BrowseScope = { vertical: Vertical; category?: undefined } | { vertical?: undefined; category: string } | null;

/** Bereich bzw. Kategorie, in der gerade gesucht wird */
export function currentScope(query: SearchQuery): BrowseScope {
  if (query.category && isCategoryPath(query.category)) return { category: query.category };
  if (query.vertical) return { vertical: query.vertical };
  return null;
}

/**
 * Link zu einem anderen Bereich bzw. einer anderen Kategorie mit denselben Filtern (Suchbegriff, Ort, Preis …).
 * Filter, die dort nicht gelten (z. B. Fahrradart beim Wechsel zu Elektronik), fallen weg; Seite wieder 1.
 */
export function scopeHref(query: SearchQuery, scope: BrowseScope): string {
  const key = scope?.category ?? (scope?.vertical ? VERTICAL_SLUGS[scope.vertical] : null);
  const filters = searchFiltersFor(key);
  const next: SearchQuery = { ...query, page: 1, vertical: undefined, category: undefined, attributes: {} };
  if (scope?.category) {
    next.category = scope.category;
    next.vertical = VERTICALS.find((v) => scope.category.startsWith(`${VERTICAL_SLUGS[v]}/`));
  } else if (scope?.vertical) next.vertical = scope.vertical;
  for (const filter of filters) {
    const value = query.attributes[filter.key];
    if (value) next.attributes[filter.key] = value;
  }
  if (!hasPrice(key)) {
    delete next.priceMin;
    delete next.priceMax;
  }
  if (!hasItemCondition(key)) delete next.conditions;
  return searchHref(next, filters);
}

/** Ein Eintrag der Kategorienavigation */
export interface BrowseEntry {
  key: string;
  label: string;
  icon: string | null;
  scope: NonNullable<BrowseScope>;
}

/** Nächste Ebene unter dem aktuellen Bereich bzw. der Kategorie (leer bei Kategorien ohne Unterkategorien) */
export function browseChildren(categories: CategoryNode[], scope: BrowseScope): BrowseEntry[] {
  const nodes = scope?.category
    ? (findCategoryByPath(categories, scope.category)?.children ?? [])
    : scope?.vertical
      ? categories.filter((c) => c.vertical === scope.vertical)
      : null;
  if (!nodes) {
    return VERTICALS.map((vertical) => ({ key: VERTICAL_SLUGS[vertical], label: VERTICAL_LABELS[vertical], icon: null, scope: { vertical } }));
  }
  return nodes.map((node) => ({ key: node.path, label: node.name, icon: node.icon, scope: { category: node.path } }));
}

/** Weg von „Alle Kategorien“ bis zur aktuellen Kategorie, z. B. Alle › Marktplatz › Elektronik › Handys */
export function browseTrail(categories: CategoryNode[], scope: BrowseScope): BrowseEntry[] {
  if (!scope) return [];
  if (scope.vertical) return [{ key: VERTICAL_SLUGS[scope.vertical], label: VERTICAL_LABELS[scope.vertical], icon: null, scope }];
  const segments = scope.category.split('/');
  const vertical = VERTICALS.find((v) => VERTICAL_SLUGS[v] === segments[0]);
  const trail: BrowseEntry[] = vertical ? [{ key: segments[0]!, label: VERTICAL_LABELS[vertical], icon: null, scope: { vertical } }] : [];
  for (let i = 2; i <= segments.length; i++) {
    const node = findCategoryByPath(categories, segments.slice(0, i).join('/'));
    if (node) trail.push({ key: node.path, label: node.name, icon: node.icon, scope: { category: node.path } });
  }
  return trail;
}

export function searchHref(query: SearchQuery, filters: readonly SearchFilter[]): string {
  const params = new URLSearchParams(toSearchParams(query, filters));
  // Kategoriepfade lesbar lassen (…?kategorie=marktplatz/computer-software) – „/“ ist in Abfragen erlaubt
  const text = params.toString().replace(/%2F/gi, '/');
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

