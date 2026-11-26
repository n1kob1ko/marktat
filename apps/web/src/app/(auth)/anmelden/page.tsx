import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { UserPlus } from 'lucide-react';
import { Alert, buttonClasses, Skeleton } from '@marktat/ui';
import { AuthShell } from '@/components/auth-shell';
import { SocialLogin } from '@/components/social-login';
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
      title="Anmelden"
      intro="Melde dich an, um Anzeigen aufzugeben und deine Inserate zu verwalten. Neu hier? Ein Konto ist kostenlos."
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
  const hint =
    (typeof params.hinweis === 'string' && HINTS[params.hinweis]) ||
    (next?.startsWith('/inserieren')
      ? 'Zum Inserieren brauchst du ein kostenloses Konto. Melde dich an oder erstelle in einer Minute ein neues.'
      : 'Bitte melde dich an, um fortzufahren.');
  return (
    <div className="space-y-5">
      {params.fehler === 'link' ? (
        <Alert tone="warning">Der Link ist ungültig oder abgelaufen. Bitte melde dich an oder fordere einen neuen Link an.</Alert>
      ) : null}
      {params.fehler === 'anbieter' ? (
        <Alert tone="warning">Die Anmeldung über den Anbieter wurde abgebrochen oder hat nicht geklappt. Bitte versuche es noch einmal oder melde dich mit E-Mail und Passwort an.</Alert>
      ) : null}
      {next ? (
        <>
          <Alert tone="info">{hint}</Alert>
          {/* Wer über „Inserieren“ oder „Merken“ hier landet, hat oft noch kein Konto: Registrieren gleich oben anbieten */}
          <Link href={`/registrieren?weiter=${encodeURIComponent(next)}`} className={buttonClasses({ variant: 'outline', size: 'lg', className: 'w-full' })}>
            <UserPlus className="size-5" aria-hidden="true" /> Noch kein Konto? Kostenlos registrieren
          </Link>
          <p className="text-center text-sm font-medium text-ink-500">oder mit deinem Konto anmelden</p>
        </>
      ) : null}
      <SocialLogin next={next} />
      <LoginForm next={next} />
    </div>
  );
}
