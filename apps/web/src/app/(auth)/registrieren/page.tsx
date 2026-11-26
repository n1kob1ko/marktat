import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Skeleton } from '@marktat/ui';
import { AuthShell } from '@/components/auth-shell';
import { SocialLogin } from '@/components/social-login';
import { safeRedirectPath } from '@/lib/auth';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Registrieren', robots: { index: false } };

export default function RegisterPage({ searchParams }: PageProps<'/registrieren'>) {
  return (
    <AuthShell
      title="Konto erstellen"
      intro="Kostenlos registrieren und in wenigen Minuten deine erste Anzeige aufgeben."
      footer={
        <>
          Schon registriert?{' '}
          <Link href="/anmelden" className="font-semibold text-brand-700 hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      <Suspense fallback={<Skeleton className="h-96" />}>
        <RegisterContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

/** ?weiter=/inserieren: nach der Bestätigung dorthin, wo die Person hinwollte */
async function RegisterContent({ searchParams }: Pick<PageProps<'/registrieren'>, 'searchParams'>) {
  const params = await searchParams;
  const next = safeRedirectPath(params.weiter, '') || undefined;
  return (
    <>
      <SocialLogin verb="registrieren" next={next} className="mb-5" />
      <RegisterForm next={next} />
    </>
  );
}
