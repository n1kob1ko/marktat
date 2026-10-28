import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Download, Rss } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { DEAL_IMPORT_FIELD_KEYS, DEAL_IMPORT_FIELDS, DEAL_IMPORT_STATUS_LABELS, formatDateTime, type DealImportSummary } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { DealImportUpload } from '@/components/deals/deal-import-upload';
import { importCountsText } from '@/lib/deal-imports';

export const metadata: Metadata = { title: 'Deals importieren', robots: { index: false } };

export default function DealImportPage({ searchParams }: PageProps<'/konto/deals/import'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <DealImport searchParams={searchParams} />
    </Suspense>
  );
}

async function DealImport({ searchParams }: Pick<PageProps<'/konto/deals/import'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireUser('/konto/deals/import'), searchParams]);
  if (user.accountType !== 'BUSINESS') {
    return <Card className="p-6 text-sm text-ink-700">Deals importieren können nur gewerbliche Konten.</Card>;
  }
  const history = await api<DealImportSummary[]>('/me/deal-imports', { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div>
        <Link href="/konto/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Meine Deals</Link>
        <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal">Deals importieren</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-600">
          Viele Angebote auf einmal einstellen oder aktualisieren: Lade eine CSV-Datei hoch, prüfe die Vorschau und übernimm sie. Angebote werden
          über deine Artikelnummer erkannt – beim nächsten Import werden sie aktualisiert statt doppelt angelegt.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="space-y-4 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li>Vorlage herunterladen und in Excel, LibreOffice oder deinem Warenwirtschaftssystem befüllen</li>
            <li>Als CSV speichern (Semikolon oder Komma, UTF-8 oder Windows-Zeichensatz) und hochladen</li>
            <li>Spalten zuordnen, Fehler je Zeile ansehen, dann übernehmen</li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <a href="/api/deals/importe/vorlage" className={buttonClasses({ variant: 'outline' })} download>
              <Download className="size-4" aria-hidden="true" /> Vorlage herunterladen
            </a>
          </div>
          <DealImportUpload />
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <h3 className="flex items-center gap-2 font-sans text-base font-semibold tracking-normal">
            <Rss className="size-4 text-brand-700" aria-hidden="true" /> Produktfeed
          </h3>
          <p className="text-ink-600">
            Du hast einen eigenen Produktfeed? Nach einer Prüfung durch unser Team holen wir ihn regelmäßig ab und halten deine Angebote aktuell.
          </p>
          <Link href="/konto/deals/feeds" className={buttonClasses({ variant: 'outline', size: 'sm' })}>Feeds verwalten</Link>
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="spalten">
        <h3 id="spalten" className="font-sans text-base font-semibold tracking-normal">Spalten der Vorlage</h3>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs font-semibold text-ink-600 uppercase">
              <tr>
                <th className="px-3 py-2">Spalte</th>
                <th className="px-3 py-2">Bedeutung</th>
                <th className="px-3 py-2">Hinweis</th>
                <th className="px-3 py-2">Beispiel</th>
              </tr>
            </thead>
            <tbody>
              {DEAL_IMPORT_FIELD_KEYS.map((key) => {
                const def = DEAL_IMPORT_FIELDS[key];
                return (
                  <tr key={key} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {def.column}
                      {def.required ? <span className="ml-1 font-sans font-semibold text-danger-600">Pflicht</span> : null}
                    </td>
                    <td className="px-3 py-2">{def.label}</td>
                    <td className="px-3 py-2 text-ink-600">{def.hint}</td>
                    <td className="px-3 py-2 text-ink-600">{def.example}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500">
          Bilder werden nicht aus Dateien oder Feeds übernommen: Lade sie beim Angebot selbst hoch und gib an, woher sie stammen. Kategorien:{' '}
          <Link href="/deals" className="font-semibold text-brand-700 hover:underline">siehe Deals</Link>.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="verlauf">
        <h3 id="verlauf" className="font-sans text-base font-semibold tracking-normal">Bisherige Importe</h3>
        {history.length === 0 ? (
          <Card className="px-6 py-8 text-center text-sm text-ink-600">Noch keine Importe.</Card>
        ) : (
          <ul className="space-y-2">
            {history.map((item) => (
              <li key={item.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                  <Link href={`/konto/deals/import/${item.id}`} className="font-semibold text-ink-950 hover:text-brand-700 hover:underline">
                    {item.source === 'FEED' ? `Feed: ${item.fileName ?? 'Produktfeed'}` : (item.fileName ?? 'CSV-Datei')}
                  </Link>
                  <span className="text-ink-500">{formatDateTime(item.createdAt)}</span>
                  <span className={item.status === 'FAILED' ? 'font-semibold text-danger-600' : 'text-ink-700'}>{DEAL_IMPORT_STATUS_LABELS[item.status]}</span>
                  <span className="text-ink-500">{importCountsText(item)}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
