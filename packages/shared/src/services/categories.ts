/**
 * Kategorien der Dienstleistungen (Anbieterprofile und Projektaufträge). Fünf Bereiche mit Unterkategorien.
 * `relatedCategoryPath` verweist auf die bestehende Kategorie der Kleinanzeigen mit ähnlichem Inhalt
 * (Marktplatz › Dienstleistungen bzw. Jobs › Freelance), damit es keine doppelte Kategorielogik gibt:
 * Inserate bleiben Inserate, Profile verlinken auf sie.
 *
 * `regulated`: Für die Tätigkeit kann in Österreich eine Gewerbeberechtigung oder ein Befähigungsnachweis nötig sein.
 * MarktAT zeigt dann einen Hinweis und Qualifikationen nur als „geprüft“, wenn das Team sie geprüft hat.
 *
 * Erweitern: Eintrag ergänzen und `pnpm db:seed` ausführen. Slugs nie umbenennen (stehen in URLs und Suchen).
 */
export interface ServiceCategoryDefinition {
  slug: string;
  name: string;
  regulated?: boolean;
  relatedCategoryPath?: string;
}

export interface ServiceCategoryGroupDefinition {
  slug: string;
  name: string;
  icon: string;
  categories: ServiceCategoryDefinition[];
}

export const SERVICE_CATEGORY_GROUPS: ServiceCategoryGroupDefinition[] = [
  {
    slug: 'it-digital',
    name: 'IT & Digital',
    icon: 'laptop',
    categories: [
      { slug: 'webentwicklung', name: 'Webentwicklung', relatedCategoryPath: 'marktplatz/dienstleistungen/it-web' },
      { slug: 'app-entwicklung', name: 'App-Entwicklung', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'grafikdesign', name: 'Grafikdesign', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'online-marketing', name: 'Online-Marketing', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'seo', name: 'SEO', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'it-support', name: 'IT-Support', relatedCategoryPath: 'marktplatz/dienstleistungen/it-web' },
      { slug: 'softwareentwicklung', name: 'Softwareentwicklung', relatedCategoryPath: 'jobs/freelance' },
    ],
  },
  {
    slug: 'haus-handwerk',
    name: 'Haus & Handwerk',
    icon: 'hammer',
    categories: [
      { slug: 'elektriker', name: 'Elektriker', regulated: true, relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' },
      { slug: 'installateur', name: 'Installateur', regulated: true, relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' },
      { slug: 'maler', name: 'Maler', regulated: true, relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' },
      { slug: 'moebelmontage', name: 'Möbelmontage', relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' },
      { slug: 'gartenpflege', name: 'Gartenpflege', relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' },
      { slug: 'reinigung', name: 'Reinigung', relatedCategoryPath: 'marktplatz/dienstleistungen/reinigungsdienste' },
    ],
  },
  {
    slug: 'bildung',
    name: 'Bildung',
    icon: 'graduation-cap',
    categories: [
      { slug: 'nachhilfe', name: 'Nachhilfe', relatedCategoryPath: 'marktplatz/dienstleistungen/nachhilfe-unterricht' },
      { slug: 'sprachunterricht', name: 'Sprachunterricht', relatedCategoryPath: 'marktplatz/dienstleistungen/nachhilfe-unterricht' },
      { slug: 'musikunterricht', name: 'Musikunterricht', relatedCategoryPath: 'marktplatz/dienstleistungen/nachhilfe-unterricht' },
      { slug: 'weiterbildung', name: 'Weiterbildung', relatedCategoryPath: 'marktplatz/dienstleistungen/nachhilfe-unterricht' },
    ],
  },
  {
    slug: 'business',
    name: 'Business',
    icon: 'briefcase',
    categories: [
      { slug: 'buchhaltung', name: 'Buchhaltung', regulated: true, relatedCategoryPath: 'jobs/freelance' },
      { slug: 'bueroservice', name: 'Büroservice', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'beratung', name: 'Beratung', regulated: true, relatedCategoryPath: 'jobs/freelance' },
      { slug: 'uebersetzungen', name: 'Übersetzungen', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'personalunterstuetzung', name: 'Personalunterstützung', regulated: true, relatedCategoryPath: 'jobs/freelance' },
    ],
  },
  {
    slug: 'kreativ',
    name: 'Kreativ',
    icon: 'palette',
    categories: [
      { slug: 'fotografie', name: 'Fotografie', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'videoproduktion', name: 'Videoproduktion', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'design', name: 'Design', relatedCategoryPath: 'jobs/freelance' },
      { slug: 'content-erstellung', name: 'Content-Erstellung', relatedCategoryPath: 'jobs/freelance' },
    ],
  },
];

export const SERVICE_CATEGORIES = SERVICE_CATEGORY_GROUPS.flatMap((group) => group.categories.map((category) => ({ ...category, group })));

export function serviceCategoryBySlug(slug: string) {
  return SERVICE_CATEGORIES.find((category) => category.slug === slug);
}

export function serviceGroupBySlug(slug: string) {
  return SERVICE_CATEGORY_GROUPS.find((group) => group.slug === slug);
}

/** Kleinanzeigen-Kategorien, in denen Dienstleistungen als Inserat stehen (Links von /dienstleistungen) */
export const SERVICE_LISTING_CATEGORY_PATHS = ['marktplatz/dienstleistungen', 'jobs/freelance'] as const;
