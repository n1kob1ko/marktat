const REPLACEMENTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'ae',
  Ö: 'oe',
  Ü: 'ue',
  ß: 'ss',
};

/** Erzeugt URL-taugliche Slugs, z. B. „Möbel & Wohnen“ → „moebel-wohnen“. */
export function slugify(value: string, maxLength = 80): string {
  return value
    .replace(/[äöüÄÖÜß]/g, (c) => REPLACEMENTS[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}
