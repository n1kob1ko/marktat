import { DEAL_IMPORT_ACTION_LABELS, toCsv, type DealImportView } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

const ENTITY_ID = /^[a-z0-9]{20,40}$/;

/**
 * Fehlerliste eines Imports als CSV (Zeile, Artikelnummer, Meldungen) zum Korrigieren in der eigenen Tabelle.
 * Zellen, die mit =, +, -, @ beginnen, werden entschärft (keine Formeln beim Öffnen in Excel).
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/deals/importe/[id]/fehler'>) {
  const { id } = await params;
  if (!ENTITY_ID.test(id)) return new Response('Nicht gefunden', { status: 404 });
  const token = await getAccessToken();
  if (!token) return new Response('Bitte melde dich an.', { status: 401 });
  let view: DealImportView;
  try {
    view = await api<DealImportView>(`/me/deal-imports/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError) return new Response(error.message, { status: error.status });
    throw error;
  }
  const rows = view.rows.filter((row) => row.action === 'ERROR' || row.action === 'SKIP' || row.warnings.length);
  const csv = toCsv([
    ['zeile', 'artikelnummer', 'titel', 'ergebnis', 'fehler', 'hinweise'],
    ...rows.map((row) => [row.line || '', row.externalId, row.title, DEAL_IMPORT_ACTION_LABELS[row.action], row.messages.join(' | '), row.warnings.join(' | ')]),
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-${id}-fehler.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
