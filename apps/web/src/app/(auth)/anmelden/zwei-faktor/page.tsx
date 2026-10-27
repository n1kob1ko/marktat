import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Skeleton } from '@marktat/ui';
import { AuthShell } from '@/components/auth-shell';
import { getAccessToken, safeRedirectPath } from '@/lib/auth';
import { getAssurance, needsSecondFactor } from '@/lib/mfa';
import { logoutAction } from '../../actions';
import { SecondFactorForm } from './second-factor-form';

export const metadata: Metadata = { title: 'Anmeldung bestätigen', robots: { index: false } };

export default function SecondFactorPage({ searchParams }: PageProps<'/anmelden/zwei-faktor'>) {
  return (
    <AuthShell
      title="Anmeldung bestätigen"
      intro="Für dein Konto ist die Zwei-Faktor-Anmeldung eingerichtet. Gib den 6-stelligen Code aus deiner Authenticator-App ein."
      footer={
        <form action={logoutAction}>
          <button type="submit" className="font-semibold text-brand-700 hover:underline">
            Abbrechen und abmelden
          </button>
        </form>
      }
    >
      <Suspense fallback={<Skeleton className="h-40" />}>
        <SecondFactorContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SecondFactorContent({ searchParams }: Pick<PageProps<'/anmelden/zwei-faktor'>, 'searchParams'>) {
  const [params, token] = await Promise.all([searchParams, getAccessToken()]);
  const next = safeRedirectPath(params.weiter);
  if (!token) redirect(`/anmelden?weiter=${encodeURIComponent(next)}`);
  // Schon bestätigt (z. B. Zurück-Taste) oder keine 2FA eingerichtet: direkt weiter
  if (!needsSecondFactor(await getAssurance())) redirect(next);
  return <SecondFactorForm next={next} />;
}
