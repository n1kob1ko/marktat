import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Skeleton } from '@marktat/ui';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Anmelden', robots: { index: false } };

/** Warum die Anmeldung nötig ist (?hinweis=…), wenn eine Aktion dorthin geführt hat */
const HINTS: Record<string, string> = {
  merken: 'Melde dich an, um Anzeigen auf deiner Merkliste zu speichern. Danach geht es direkt zurück.',
  nachricht: 'Melde dich an, um dem Anbieter eine Nachricht zu schreiben. Danach geht es direkt zurück zur Anzeige.',
  suche: 'Melde dich an, um diese Suche zu speichern. Danach geht es direkt zurück zu deinen Ergebnissen.',
};

export default function LoginPage({ searchParams }: PageProps<'/anmelden'>) {
  return (
    <AuthShell
      title="Willkommen zurück"
      intro="Melde dich an, um Anzeigen aufzugeben und deine Inserate zu verwalten."
      footer={
        <>
          Noch kein Konto?{' '}
          <Link href="/registrieren" className="font-semibold text-brand-700 hover:underline">
            Jetzt kostenlos registrieren
          </Link>
        </>
      }
    >
      <Suspense fallback={<Skeleton className="h-72" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<'/anmelden'>, 'searchParams'>) {
  const params = await searchParams;
  const next = typeof params.weiter === 'string' ? params.weiter : undefined;
  return (
    <div className="space-y-5">
      {params.fehler === 'link' ? (
        <Alert tone="warning">Der Link ist ungültig oder abgelaufen. Bitte melde dich an oder fordere einen neuen Link an.</Alert>
      ) : null}
      {next ? (
        <Alert tone="info">{(typeof params.hinweis === 'string' && HINTS[params.hinweis]) || 'Bitte melde dich an, um fortzufahren.'}</Alert>
      ) : null}
      <LoginForm next={next} />
    </div>
  );
}
