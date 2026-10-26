import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Alert, Badge, Card, Skeleton } from '@marktat/ui';
import { formatDate } from '@marktat/shared';
import { requireUser } from '@/lib/auth';
import { ProfileForm } from './profile-form';

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
        {params.bestaetigt ? <Alert tone="success">Deine E-Mail-Adresse ist bestätigt. Willkommen bei MarktAT!</Alert> : null}
        {params.passwort === 'geaendert' ? <Alert tone="success">Dein Passwort wurde geändert.</Alert> : null}
        <Card className="p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Profil bearbeiten</h2>
          <div className="mt-5">
            <ProfileForm user={user} />
          </div>
        </Card>
      </div>
      <aside className="space-y-4">
        <Card className="space-y-3 p-5 text-sm">
          <p className="font-semibold text-ink-900">{user.email}</p>
          <div className="flex flex-wrap gap-2">
            <Badge tone={user.accountType === 'BUSINESS' ? 'brand' : 'neutral'}>
              {user.accountType === 'BUSINESS' ? 'Gewerbliches Konto' : 'Privates Konto'}
            </Badge>
            {user.role !== 'USER' ? <Badge tone="accent">{user.role === 'ADMIN' ? 'Administration' : 'Moderation'}</Badge> : null}
          </div>
          <p className="text-ink-500">Mitglied seit {formatDate(user.createdAt)}</p>
        </Card>
        <Card className="p-5 text-sm text-ink-600">
          <p className="font-semibold text-ink-900">Datenschutz</p>
          <p className="mt-1.5 leading-relaxed">Datenexport und Kontolöschung (DSGVO Art. 15, 17, 20) folgen in einer der nächsten Ausbaustufen.</p>
        </Card>
      </aside>
    </div>
  );
}
