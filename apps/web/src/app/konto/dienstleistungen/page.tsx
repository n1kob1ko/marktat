import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Eye } from 'lucide-react';
import { Alert, Badge, buttonClasses, Card, Skeleton } from '@marktat/ui';
import {
  MODERATION_ACTION_LABELS,
  PORTFOLIO_IMAGE_RIGHTS_LABELS,
  QUALIFICATION_STATUS_LABELS,
  SERVICE_MAX_PORTFOLIO,
  SERVICE_MAX_QUALIFICATIONS,
  type MyServiceProfile,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ServiceImageUpload } from '@/components/services/service-image-upload';
import { ServiceStatusBadge } from '@/components/services/service-status-badge';
import {
  DeletePortfolioItemButton,
  DeleteQualificationButton,
  DeleteServiceProfileForm,
  PortfolioItemForm,
  QualificationForm,
  ServiceProfileForm,
  ServiceProfileStatusActions,
} from './forms';

export const metadata: Metadata = { title: 'Mein Anbieterprofil', robots: { index: false } };

export default function MyServiceProfilePage({ searchParams }: PageProps<'/konto/dienstleistungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <MyServiceProfileView searchParams={searchParams} />
    </Suspense>
  );
}

async function MyServiceProfileView({ searchParams }: Pick<PageProps<'/konto/dienstleistungen'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireUser('/konto/dienstleistungen'), searchParams]);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const { profile, missingAccountFields } = await api<MyServiceProfile>('/me/service-profile', { token, cache: 'no-store' });

  if (!profile) {
    return (
      <div className="space-y-6">
        <FlashMessage hinweis={hinweis} />
        <Card className="space-y-3 p-5 sm:p-7">
          <h2 className="font-sans text-xl font-semibold tracking-normal">Dienstleistungen anbieten</h2>
          <p className="text-sm text-ink-700">
            Mit einem Anbieterprofil findest du Kund:innen für deine Dienstleistungen – als Freelancer:in, Handwerksbetrieb oder privat. Das Profil gehört zu
            deinem bestehenden Konto, eine eigene Registrierung brauchst du nicht. Anfragen kommen über die Nachrichten von MarktAT; Provisionen oder Zahlungen
            über MarktAT gibt es nicht.
          </p>
          <p className="text-sm text-ink-700">
            Bewertungen und Auszeichnungen gibt es bewusst nicht. Qualifikationen erscheinen als „Angabe der Anbieter:in“, bis unser Team den Nachweis geprüft hat.
          </p>
        </Card>
        <Card className="p-5 sm:p-7">
          <ServiceProfileForm profile={null} />
        </Card>
      </div>
    );
  }

  const categories = profile.categories.map((c) => ({ slug: c.slug, name: c.name }));
  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-xl font-semibold tracking-normal break-words">{profile.headline}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <ServiceStatusBadge status={profile.status} />
            {profile.status === 'ACTIVE' ? <span>Sichtbar unter „Dienstleistungen“</span> : null}
          </div>
        </div>
        <Link href={`/dienstleistungen/${profile.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Eye className="size-4" aria-hidden="true" /> Ansehen
        </Link>
      </div>

      {profile.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[profile.moderation.action]}>
          {profile.moderation.statement}{' '}
          <Link href={`/konto/entscheidungen/${profile.moderation.decisionId}`} className="font-semibold underline">
            Begründung und Einspruch
          </Link>
        </Alert>
      ) : profile.reviewReason && profile.status === 'PENDING_REVIEW' ? (
        <Alert tone="info" title="In Prüfung">{profile.reviewReason}</Alert>
      ) : null}
      {missingAccountFields.length ? (
        <Alert tone="warning" title="Angaben für gewerbliche Anbieter fehlen">
          Bitte ergänze in deinem <Link href="/konto" className="font-semibold underline">Profil</Link>: {missingAccountFields.join(', ')}. Ohne diese Angaben
          (Impressum) kann das Anbieterprofil nicht veröffentlicht werden.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="order-2 space-y-6 lg:order-1">
          <Card className="p-5 sm:p-7">
            <ServiceProfileForm profile={profile} />
          </Card>

          <Card className="space-y-5 p-5 sm:p-7" id="portfolio">
            <div>
              <h3 className="font-sans text-lg font-semibold tracking-normal">Portfolio und Arbeitsproben</h3>
              <p className="mt-1 text-sm text-ink-600">
                Bis zu {SERVICE_MAX_PORTFOLIO} Einträge. Zeige nur eigene Arbeiten; Bilder von Kund:innen-Projekten nur mit deren Erlaubnis.
              </p>
            </div>
            {profile.portfolio.map((item) => (
              <details key={item.id} id={`portfolio-${item.id}`} className="rounded-xl border border-line p-4" open={params.eintrag === item.id}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold text-ink-900">
                  {item.title}
                  {item.hidden ? <Badge tone="warning">Vom Team ausgeblendet</Badge> : null}
                  {!item.imageUrl ? <span className="text-xs font-normal text-ink-500">ohne Bild</span> : null}
                </summary>
                <div className="mt-4 space-y-5">
                  <PortfolioItemForm item={item} categories={categories} />
                  <div className="border-t border-line pt-4">
                    <ServiceImageUpload
                      endpoint={`/api/medien/dienstleistungen/portfolio/${item.id}`}
                      imageUrl={item.imageUrl}
                      rights={item.imageRights}
                      credit={item.imageCredit}
                      label={`Bild zu „${item.title}“`}
                    />
                    {item.imageRights ? <p className="mt-2 text-xs text-ink-500">Bildrechte: {PORTFOLIO_IMAGE_RIGHTS_LABELS[item.imageRights]}</p> : null}
                  </div>
                  <DeletePortfolioItemButton id={item.id} />
                </div>
              </details>
            ))}
            {profile.portfolio.length < SERVICE_MAX_PORTFOLIO ? (
              <div className="rounded-xl border border-dashed border-line-strong p-4" data-testid="portfolio-new">
                <h4 className="mb-3 text-sm font-semibold text-ink-900">Neuer Eintrag</h4>
                <PortfolioItemForm categories={categories} />
              </div>
            ) : null}
          </Card>

          <Card className="space-y-5 p-5 sm:p-7" id="qualifikationen">
            <div>
              <h3 className="font-sans text-lg font-semibold tracking-normal">Qualifikationen und Berechtigungen</h3>
              <p className="mt-1 text-sm text-ink-600">
                Bis zu {SERVICE_MAX_QUALIFICATIONS} Angaben, z. B. Meisterprüfung oder Gewerbeberechtigung. Öffentlich stehen sie als „Angabe der Anbieter:in, nicht
                geprüft“, bis unser Team den Nachweis (z. B. im GISA) abgeglichen hat. Die Nummer ist erst danach öffentlich.
              </p>
            </div>
            {profile.qualifications.length ? (
              <ul className="divide-y divide-line">
                {profile.qualifications.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">{q.title}</p>
                      <p className="text-sm text-ink-600">{[q.issuer, q.reference ? `Nr. ${q.reference}` : null].filter(Boolean).join(' · ')}</p>
                      <Badge tone={q.status === 'VERIFIED' ? 'success' : q.status === 'REJECTED' ? 'danger' : 'neutral'} className="mt-1">
                        {QUALIFICATION_STATUS_LABELS[q.status]}
                      </Badge>
                    </div>
                    <DeleteQualificationButton id={q.id} />
                  </li>
                ))}
              </ul>
            ) : null}
            {profile.qualifications.length < SERVICE_MAX_QUALIFICATIONS ? <QualificationForm /> : null}
          </Card>
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <Card className="space-y-3 p-5">
            <h3 className="font-sans text-base font-semibold tracking-normal">Status</h3>
            <ServiceProfileStatusActions status={profile.status} />
            {profile.status === 'PENDING_REVIEW' ? <p className="text-sm text-ink-600">Unser Team prüft dein Profil. Du bekommst eine Mitteilung.</p> : null}
          </Card>
          <Card className="space-y-3 p-5">
            <h3 className="font-sans text-base font-semibold tracking-normal">Profilbild oder Logo</h3>
            <ServiceImageUpload endpoint="/api/medien/dienstleistungen" imageUrl={profile.imageRights ? profile.imageUrl : null} rights={profile.imageRights} credit={profile.imageCredit} label="Profilbild" round />
          </Card>
          <Card className="space-y-3 p-5">
            <h3 className="font-sans text-base font-semibold tracking-normal">Profil löschen</h3>
            <p className="text-sm text-ink-600">Dein Konto, deine Anzeigen und Nachrichten bleiben erhalten.</p>
            <DeleteServiceProfileForm />
          </Card>
        </div>
      </div>
    </div>
  );
}
