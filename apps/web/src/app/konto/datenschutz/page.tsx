import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Download } from 'lucide-react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { requireUser } from '@/lib/auth';
import { DeletionForm } from './deletion-form';

export const metadata: Metadata = { title: 'Datenschutz', robots: { index: false } };

const ERRORS: Record<string, string> = {
  export: 'Der Datenexport hat nicht geklappt. Bitte versuche es gleich noch einmal.',
  'export-limit': 'Du hast deine Daten in der letzten Stunde schon mehrmals exportiert. Bitte versuche es später noch einmal.',
};

export default function PrivacyPage({ searchParams }: PageProps<'/konto/datenschutz'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Privacy searchParams={searchParams} />
    </Suspense>
  );
}

async function Privacy({ searchParams }: Pick<PageProps<'/konto/datenschutz'>, 'searchParams'>) {
  const [{ user }, params] = await Promise.all([requireUser('/konto/datenschutz', { allowSuspended: true }), searchParams]);
  const error = typeof params.fehler === 'string' ? ERRORS[params.fehler] : undefined;

  return (
    <div className="max-w-3xl space-y-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card className="space-y-3 p-5 sm:p-7">
        <h2 className="font-sans text-lg font-semibold tracking-normal">Deine Daten herunterladen</h2>
        <p className="text-sm leading-relaxed text-ink-600">
          Eine JSON-Datei mit deinem Profil und deinen Einstellungen, deinen Anzeigen, deiner Merkliste, gespeicherten Suchen, deinen eigenen Nachrichten, Meldungen, Entscheidungen
          und Mitteilungen (Art. 15 und 20 DSGVO). Nachrichten anderer Personen und Angaben über andere enthält der Export nicht.
        </p>
        {/* Normaler Link statt next/link: der Download kommt vom Route Handler */}
        <a href="/konto/datenschutz/export" className={buttonClasses({ variant: 'outline' })} download>
          <Download className="size-4" aria-hidden="true" /> Datenexport herunterladen
        </a>
      </Card>

      <Card className="space-y-3 border-danger-600/30 p-5 sm:p-7">
        <h2 className="font-sans text-lg font-semibold tracking-normal">Konto löschen</h2>
        <div className="space-y-2 text-sm leading-relaxed text-ink-600">
          <p>Wir löschen dein Konto bei der Anmeldung, dein Profil, deine Anzeigen mit allen Bildern, Merkliste, gespeicherte Suchen, Unterhaltungen und geplante E-Mails.</p>
          <p>
            Was wir aus rechtlichen Gründen eine Zeit lang aufbewahren müssen – etwa Moderationsentscheidungen und das Sicherheitsprotokoll – bleibt ohne deinen Namen und deine
            E-Mail-Adresse erhalten und wird nach Ablauf der Fristen gelöscht. Details stehen in der{' '}
            <Link href="/datenschutz" className="font-semibold text-brand-700 hover:underline">Datenschutzerklärung</Link>.
          </p>
          <p className="font-semibold text-ink-900">Die Löschung kann nicht rückgängig gemacht werden.</p>
        </div>
        {user.role === 'ADMIN' ? (
          <Alert tone="warning">Als Administrator kannst du dein Konto nur löschen, wenn es noch eine weitere aktive Administration gibt.</Alert>
        ) : null}
        <DeletionForm />
      </Card>
    </div>
  );
}
