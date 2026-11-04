/**
 * Kategorien für Deals & Angebote. Eigene Liste, weil Händlerangebote (Lebensmittel, Drogerie, Reisen …) nicht in
 * den Kategoriebaum der Kleinanzeigen passen. Wo es eine passende Marktplatz-Kategorie gibt, verweist
 * `relatedCategoryPath` darauf (z. B. „Ähnliche Kleinanzeigen“) – es entstehen keine doppelten Kategorien.
 *
 * Erweitern: Eintrag ergänzen und `pnpm db:seed` ausführen. Slugs nie umbenennen (stehen in URLs und Suchen).
 */
export interface DealCategoryDefinition {
  slug: string;
  name: string;
  /** lucide-Icon */
  icon: string;
  /** Pfad einer bestehenden Kategorie der Kleinanzeigen mit ähnlichem Inhalt */
  relatedCategoryPath?: string;
}

export const DEAL_CATEGORIES: readonly DealCategoryDefinition[] = [
  { slug: 'elektronik-computer', name: 'Elektronik & Computer', icon: 'laptop', relatedCategoryPath: 'marktplatz/computer-software' },
  { slug: 'smartphones-tablets', name: 'Smartphones & Tablets', icon: 'smartphone', relatedCategoryPath: 'marktplatz/smartphones-telefonie/smartphones' },
  { slug: 'gaming', name: 'Gaming', icon: 'gamepad-2', relatedCategoryPath: 'marktplatz/games-konsolen' },
  { slug: 'tv-audio', name: 'TV & Audio', icon: 'tv', relatedCategoryPath: 'marktplatz/kameras-tv-multimedia' },
  { slug: 'haushalt-kueche', name: 'Haushalt & Küche', icon: 'washing-machine', relatedCategoryPath: 'marktplatz/wohnen-haushalt-gastronomie' },
  { slug: 'moebel-wohnen', name: 'Möbel & Wohnen', icon: 'sofa', relatedCategoryPath: 'marktplatz/wohnen-haushalt-gastronomie' },
  { slug: 'baumarkt-garten', name: 'Baumarkt & Garten', icon: 'flower-2', relatedCategoryPath: 'marktplatz/haus-garten-werkstatt' },
  { slug: 'mode-schuhe', name: 'Mode & Schuhe', icon: 'shirt', relatedCategoryPath: 'marktplatz/mode-accessoires' },
  { slug: 'sport-freizeit', name: 'Sport & Freizeit', icon: 'bike', relatedCategoryPath: 'marktplatz/sport-sportgeraete' },
  { slug: 'lebensmittel', name: 'Lebensmittel', icon: 'shopping-basket' },
  { slug: 'drogerie', name: 'Drogerie', icon: 'spray-can' },
  { slug: 'baby-familie', name: 'Baby & Familie', icon: 'baby', relatedCategoryPath: 'marktplatz/baby-kind' },
  { slug: 'autozubehoer', name: 'Autozubehör', icon: 'car', relatedCategoryPath: 'auto-motor/fahrzeugzubehoer/auto-zubehoer' },
  { slug: 'reisen-freizeit', name: 'Reisen & Freizeit', icon: 'plane' },
  { slug: 'filme-musik-buecher', name: 'Filme, Musik & Bücher', icon: 'book-open', relatedCategoryPath: 'marktplatz/buecher-filme-musik' },
  { slug: 'sonstige-angebote', name: 'Sonstige Angebote', icon: 'tag' },
];

export function dealCategoryBySlug(slug: string): DealCategoryDefinition | undefined {
  return DEAL_CATEGORIES.find((category) => category.slug === slug);
}
