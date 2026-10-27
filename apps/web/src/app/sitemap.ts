import type { MetadataRoute } from 'next';
import type { SitemapEntries } from '@marktat/shared';
import { api } from '@/lib/api';
import { serverEnv } from '@/lib/env';

/** Sitemap aus öffentlichen Inseraten, Händlerprofilen und Kategorien; wird stündlich neu erzeugt. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  'use cache';
  const base = serverEnv.webUrl;
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/suche`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${base}/impressum`, changeFrequency: 'yearly', priority: 0.1 },
    { url: `${base}/datenschutz`, changeFrequency: 'yearly', priority: 0.1 },
    { url: `${base}/agb`, changeFrequency: 'yearly', priority: 0.1 },
    { url: `${base}/kontakt`, changeFrequency: 'yearly', priority: 0.1 },
  ];
  if (!serverEnv.allowIndexing) return pages;
  const entries = await api<SitemapEntries>('/seo/sitemap').catch(() => null);
  if (!entries) return pages;
  return [
    ...pages,
    ...entries.categories.map((path) => ({ url: `${base}/suche?kategorie=${encodeURIComponent(path)}`, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...entries.dealers.map((d) => ({ url: `${base}/haendler/${d.id}`, lastModified: d.updatedAt, changeFrequency: 'daily' as const, priority: 0.5 })),
    ...entries.listings.map((l) => ({ url: `${base}/anzeige/${l.id}`, lastModified: l.updatedAt, changeFrequency: 'weekly' as const, priority: 0.7 })),
  ];
}
