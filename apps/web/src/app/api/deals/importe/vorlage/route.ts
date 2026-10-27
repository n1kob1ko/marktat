import { dealImportTemplateCsv } from '@marktat/shared';

/** Leere Vorlage (nur Kopfzeile, Semikolon, UTF-8 mit BOM für Excel) */
export function GET() {
  return new Response(dealImportTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="marktat-deals-vorlage.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
