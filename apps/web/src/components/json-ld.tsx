import { serializeJsonLd } from '@/lib/seo';

/** Strukturierte Daten für Suchmaschinen (schema.org) */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
