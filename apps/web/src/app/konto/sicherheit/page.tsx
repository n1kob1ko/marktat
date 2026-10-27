import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Alert, Card, Skeleton } from '@marktat/ui';
import { formatDate } from '@marktat/shared';
import { isStaff, requireUser } from '@/lib/auth';
import { getAssurance } from '@/lib/mfa';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FlashMessage } from '@/components/flash-message';
import { EnrollForm, RemoveFactorForm } from './mfa-forms';

export const metadata: Metadata = { title: 'Sicherheit', robots: { index: false } };

const MAX_FACTORS = 3;

export default function SecurityPage({ searchParams }: PageProps<'/konto/sicherheit'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Security searchParams={searchParams} />
    </Suspense>
  );
}

async function Security({ searchParams }: Pick<PageProps<'/konto/sicherheit'>, 'searchParams'>) {
  const [{ user }, params] = await Promise.all([requireUser('/konto/sicherheit'), searchParams]);
  // Vorerst nur für das Team (Moderation, Administration); andere Konten sehen die Seite nicht
  if (!isStaff(user)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: factors }, assurance] = await Promise.all([supabase.auth.mfa.listFactors(), getAssurance()]);
  const verified = factors?.totp ?? [];
  const required = Boolean(user.security?.mfaRequired);

  return (
    <div className="max-w-3xl space-y-6">
      <FlashMessage hinweis={typeof params.hinweis === 'string' ? params.hinweis : undefined} />
      {params.grund === 'pflicht' && !verified.length ? (
        <Alert tone="warning">Für den Admin-Bereich ist die Zwei-Faktor-Anmeldung Pflicht. Richte sie jetzt ein – danach geht es weiter.</Alert>
      ) : null}

      <Card className="space-y-4 p-5 sm:p-7">
        <div className="flex items-start gap-3">
          {verified.length ? (
            <ShieldCheck className="mt-0.5 size-6 shrink-0 text-success-700" aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warning-700" aria-hidden="true" />
          )}
          <div className="space-y-1">
            <h2 className="font-sans text-lg font-semibold tracking-normal">
              Zwei-Faktor-Anmeldung: {verified.length ? 'aktiv' : 'nicht eingerichtet'}
            </h2>
            <p className="text-sm leading-relaxed text-ink-600">
              Zusätzlich zum Passwort fragt MarktAT bei der Anmeldung nach einem 6-stelligen Code aus einer Authenticator-App (z. B. Aegis, Google Authenticator,
              Microsoft Authenticator, 1Password). Kritische Aktionen im Admin-Bereich – Rollen, Kontosperren, Preise – bestätigst du ebenfalls mit einem Code.
              {required ? ' Für dein Konto ist sie Pflicht.' : ''}
            </p>
          </div>
        </div>

        {verified.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {verified.map((factor) => (
              <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
                <div className="text-sm">
                  <p className="font-semibold text-ink-900">{factor.friendly_name || 'Authenticator-App'}</p>
                  <p className="text-ink-500">Eingerichtet am {formatDate(factor.created_at)}</p>
                </div>
                <RemoveFactorForm factorId={factor.id} name={factor.friendly_name || 'Authenticator-App'} disabled={assurance.current !== 'aal2'} />
              </li>
            ))}
          </ul>
        ) : null}
        {verified.length === 1 ? (
          <Alert tone="info">
            Tipp: Richte ein zweites Gerät ein (z. B. Tablet oder Passwort-Manager). Geht das Handy verloren, meldest du dich damit weiter an. Sonst kann nur eine andere
            Administration oder der Serverzugang die Zwei-Faktor-Anmeldung zurücksetzen.
          </Alert>
        ) : null}
      </Card>

      {verified.length < MAX_FACTORS ? (
        <Card className="space-y-4 p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">{verified.length ? 'Weiteres Gerät einrichten' : 'Jetzt einrichten'}</h2>
          <EnrollForm />
        </Card>
      ) : null}
    </div>
  );
}
