import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, Badge, Card, Skeleton } from '@marktat/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatDate } from '@marktat/shared';
import { isStaff, requireUser } from '@/lib/auth';
import { changeAccountTypeAction } from './actions';
import { ProfileForm } from './profile-form';
import { LogoUpload } from './logo-upload';

export const metadata: Metadata = { title: 'Mein Konto', robots: { index: false } };

export default function AccountPage({ searchParams }: PageProps<'/konto'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AccountContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountContent({ searchParams }: Pick<PageProps<'/konto'>, 'searchParams'>) {
  const [{ user }, params] = await Promise.all([requireUser('/konto'), searchParams]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {params.bestaetigt ? <Alert tone="success">Deine E-Mail-Adresse ist bestätigt. Willkommen bei Markterl!</Alert> : null}
        {params.passwort === 'geaendert' ? <Alert tone="success">Dein Passwort wurde geändert.</Alert> : null}
        {params.kontotyp === 'gewerblich' ? (
          <Alert tone="success">Dein Konto ist jetzt gewerblich. Deals, Händlerprofil und Anbieterprofil kannst du ohne Firmenangaben nutzen.</Alert>
        ) : null}
        {params.kontotyp === 'privat' ? <Alert tone="success">Dein Konto ist jetzt privat.</Alert> : null}
        {params.kontotyp === 'fehler' ? <Alert tone="danger">Der Kontotyp konnte nicht geändert werden. Bitte versuche es noch einmal.</Alert> : null}
        <Card className="p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Profil bearbeiten</h2>
          <div className="mt-5">
            <ProfileForm user={user} />
          </div>
        </Card>
        <Card className="p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">{user.accountType === 'BUSINESS' ? 'Firmenlogo' : 'Profilbild'}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {user.accountType === 'BUSINESS'
              ? 'Erscheint auf deinem Händlerprofil und bei deinen Anzeigen.'
              : 'Erscheint bei deinen Anzeigen und in Unterhaltungen – so wirkst du für Interessierte greifbarer.'}
          </p>
          <div className="mt-4">
            <LogoUpload logoUrl={user.logoUrl} kind={user.accountType === 'BUSINESS' ? 'logo' : 'avatar'} />
          </div>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card className="space-y-3 p-5 text-sm">
          <p className="font-semibold text-ink-900">{user.email}</p>
          <Link href="/konto/sicherheit" className="inline-block font-semibold text-brand-700 hover:underline">Passwort oder E-Mail-Adresse ändern</Link>
          <div className="flex flex-wrap gap-2">
            <Badge tone={user.accountType === 'BUSINESS' ? 'brand' : 'neutral'}>
              {user.accountType === 'BUSINESS' ? 'Gewerbliches Konto' : 'Privates Konto'}
            </Badge>
            {user.role !== 'USER' ? <Badge tone="accent">{user.role === 'ADMIN' ? 'Administration' : 'Moderation'}</Badge> : null}
          </div>
          <p className="text-ink-500">Mitglied seit {formatDate(user.createdAt)}</p>
          {user.accountType === 'BUSINESS' ? (
            <div className="flex flex-col gap-1">
              <Link href="/konto/haendler" className="font-semibold text-brand-700 hover:underline">Händler-Dashboard</Link>
              <Link href={`/haendler/${user.id}`} className="font-semibold text-brand-700 hover:underline">Mein öffentliches Händlerprofil</Link>
            </div>
          ) : null}
          {isStaff(user) ? (
            <Link href="/admin" className="inline-block font-semibold text-brand-700 hover:underline">Zum Moderationsbereich</Link>
          ) : null}
        </Card>
        {user.role === 'ADMIN' ? (
          <Card className="space-y-3 p-5 text-sm text-ink-600">
            <p className="font-semibold text-ink-900">Administration: keine Limits</p>
            <p className="leading-relaxed">
              Für dein Konto gelten keine Mengen- und Zeitlimits. Als gewerbliches Konto brauchst du keine Firmenangaben und keine Händlerbestätigung.
            </p>
            <form action={changeAccountTypeAction}>
              <input type="hidden" name="accountType" value={user.accountType === 'BUSINESS' ? 'PRIVATE' : 'BUSINESS'} />
              <SubmitButton variant="outline" size="sm">
                {user.accountType === 'BUSINESS' ? 'Auf privat umstellen' : 'Auf gewerblich umstellen'}
              </SubmitButton>
            </form>
          </Card>
        ) : null}
        <Card className="p-5 text-sm text-ink-600">
          <p className="font-semibold text-ink-900">Datenschutz</p>
          <p className="mt-1.5 leading-relaxed">Lade alle deine Daten herunter oder lösche dein Konto (DSGVO Art. 15, 17, 20).</p>
          <Link href="/konto/datenschutz" className="mt-2 inline-block font-semibold text-brand-700 hover:underline">Zu Datenexport und Löschung</Link>
        </Card>
      </aside>
    </div>
  );
}
