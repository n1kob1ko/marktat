import {
  ATTRIBUTE_RULE_PATHS,
  DEAL_CATEGORIES,
  LEGACY_CATEGORY_PATHS,
  categoryAttributeSchema,
  missingRequiredAttributes,
  parseListingAttributes,
  slugify,
  VERTICAL_SLUGS,
  type Vertical,
} from '@marktat/shared';
import { CATEGORY_TREE, type CategorySeed } from './categories.js';
import { DEMO_LISTINGS } from './demo.js';

/** Pfade genau so, wie seed.ts sie in `categories.path` schreibt. */
function allPaths(): { path: string; leaf: boolean }[] {
  const result: { path: string; leaf: boolean }[] = [];
  const walk = (nodes: CategorySeed[], prefix: string) => {
    for (const node of nodes) {
      const path = `${prefix}/${slugify(node.name)}`;
      result.push({ path, leaf: !node.children?.length });
      if (node.children) walk(node.children, path);
    }
  };
  for (const [vertical, nodes] of Object.entries(CATEGORY_TREE)) walk(nodes, VERTICAL_SLUGS[vertical as Vertical]);
  return result;
}

describe('Zusatzfelder und Kategoriebaum', () => {
  const paths = allPaths();

  it('Deal-Kategorien verweisen nur auf existierende Kategorien der Kleinanzeigen', () => {
    const known = new Set(paths.map((p) => p.path));
    expect(DEAL_CATEGORIES.filter((c) => c.relatedCategoryPath && !known.has(c.relatedCategoryPath)).map((c) => c.slug)).toEqual([]);
  });

  it('alte Kategoriepfade zeigen auf existierende, nicht mehr verwendete auf neue Kategorien', () => {
    const byPath = new Map(paths.map((p) => [p.path, p]));
    const targets = Object.entries(LEGACY_CATEGORY_PATHS);
    expect(targets.filter(([, to]) => !byPath.has(to)).map(([from]) => from)).toEqual([]);
    // Alte Pfade, die es im Baum noch gibt, würden nie umgezogen
    expect(targets.filter(([from]) => byPath.has(from)).map(([from]) => from)).toEqual([]);
    // Inserate stehen nur in Unterkategorien ohne weitere Ebene: alte Blätter ziehen in neue Blätter
    const oldLeaves = targets.filter(([from]) => !targets.some(([other]) => other.startsWith(`${from}/`)));
    expect(oldLeaves.filter(([, to]) => !byPath.get(to)?.leaf).map(([from]) => from)).toEqual([]);
  });

  it('jede Regel verweist auf eine existierende Kategorie', () => {
    const known = new Set([...Object.values(VERTICAL_SLUGS), ...paths.map((p) => p.path)]);
    expect(ATTRIBUTE_RULE_PATHS.filter((path) => !known.has(path))).toEqual([]);
  });

  it('Fahrzeuge, Immobilien und Jobs haben in jeder Unterkategorie Zusatzfelder', () => {
    const withoutFields = paths
      .filter((p) => p.leaf && /^(auto-motor|immobilien|jobs)\//.test(p.path) && !p.path.startsWith('auto-motor/fahrzeugzubehoer'))
      .filter((p) => categoryAttributeSchema(p.path).fields.length === 0)
      .map((p) => p.path);
    expect(withoutFields).toEqual([]);
  });

  it('Demo-Inserate haben gültige und vollständige Zusatzangaben', () => {
    for (const item of DEMO_LISTINGS) {
      const schema = categoryAttributeSchema(item.path);
      const { attributes, issues } = parseListingAttributes(schema, 'attributes' in item ? { ...item.attributes } : {});
      expect({ path: item.path, issues, missing: missingRequiredAttributes(schema, attributes) }).toEqual({ path: item.path, issues: [], missing: [] });
    }
  });
});
