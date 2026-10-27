import { Injectable } from '@nestjs/common';
import type { CategoryNode } from '@marktat/shared';
import type { Category } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CACHE_TTL_MS = 5 * 60_000;

interface CategoryIndex {
  tree: CategoryNode[];
  byId: Map<string, Category>;
  byPath: Map<string, Category>;
  childrenOf: Map<string, string[]>;
  loadedAt: number;
}

/** Kategorien ändern sich selten – sie werden für 5 Minuten im Speicher gehalten. */
@Injectable()
export class CategoriesService {
  private cache?: CategoryIndex;

  constructor(private readonly prisma: PrismaService) {}

  async tree(): Promise<CategoryNode[]> {
    return (await this.index()).tree;
  }

  async findActive(id: string): Promise<Category | undefined> {
    const category = (await this.index()).byId.get(id);
    return category?.isActive ? category : undefined;
  }

  async isLeaf(id: string): Promise<boolean> {
    return !(await this.index()).childrenOf.get(id)?.length;
  }

  /** Kategorie inklusive aller Unterkategorien (für Filter). */
  async subtreeIds(id: string): Promise<string[]> {
    const { childrenOf } = await this.index();
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const current = stack.pop()!;
      result.push(current);
      stack.push(...(childrenOf.get(current) ?? []));
    }
    return result;
  }

  async findByPath(path: string): Promise<Category | undefined> {
    return (await this.index()).byPath.get(path);
  }

  /** Namen einer Kategorie und ihrer Oberkategorien je Pfad, z. B. „Fahrräder“, „Sport & Freizeit“ (für die Volltextsuche). */
  async namesByPath(): Promise<Map<string, string[]>> {
    const { byId } = await this.index();
    const names = new Map<string, string[]>();
    for (const category of byId.values()) {
      const chain: string[] = [];
      for (let c: Category | undefined = category; c; c = c.parentId ? byId.get(c.parentId) : undefined) chain.push(c.name);
      names.set(category.path, chain);
    }
    return names;
  }

  invalidate() {
    this.cache = undefined;
  }

  private async index(): Promise<CategoryIndex> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache;
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const byId = new Map(all.map((c) => [c.id, c]));
    const childrenOf = new Map<string, string[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
    }
    const build = (c: Category): CategoryNode => ({
      id: c.id,
      slug: c.slug,
      path: c.path,
      name: c.name,
      vertical: c.vertical,
      icon: c.icon,
      children: (childrenOf.get(c.id) ?? []).map((childId) => build(byId.get(childId)!)),
    });
    const tree = all.filter((c) => !c.parentId).map(build);
    this.cache = { tree, byId, byPath: new Map(all.map((c) => [c.path, c])), childrenOf, loadedAt: Date.now() };
    return this.cache;
  }
}
