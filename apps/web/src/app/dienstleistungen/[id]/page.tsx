import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeCheck, BadgeInfo, Briefcase, CalendarClock, ExternalLink, Flag, Globe, ImageIcon, MapPin, MessageCircle, Pencil, ShieldCheck, UserRound } from 'lucide-react';
import { Alert, Badge, buttonClasses, Card, Container, Skeleton } from '@marktat/ui';
import {
  MODERATION_ACTION_LABELS,
  PORTFOLIO_IMAGE_RIGHTS_LABELS,
  QUALIFICATION_STATUS_LABELS,
  SERVICE_AVAILABILITY_LABELS,
  SERVICE_PROFILE_STATUS_LABELS,
  formatDate,
  type ServiceProfileDetail,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, getCurrentUser, isStaff } from '@/lib/auth';
import { metaDescription } from '@/lib/seo';
import { serviceAreaLabel, servicePriceLabel } from '@/lib/services';
import { FlashMessage } from '@/components/flash-message';
import { ItemFavoriteButton } from '@/components/favorites/item-favorite-button';
import { ContactForm } from '@/components/messages/contact-form';

async function loadProfile(id: string, token: string | null) {
  try {
    return await api<ServiceProfileDetail>(`/services/${id}`, { token: token ?? undefined, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<'/dienstleistungen/[id]'>): Promise<Metadata> {
  const [{ id }, token] = await Promise.all([params, getAccessToken()]);
  const profile = await loadProfile(id, token).catch(() => null);
  if (!profile) return { title: 'Anbieterprofil nicht gefunden', robots: { index: false } };
  const description = metaDescription(profile.summary, `${profile.headline} – ${profile.provider.name}`);
  return {
    title: `${profile.headline} – ${profile.provider.name}`,
    description,
    alternates: { canonical: `/dienstleistungen/${profile.id}` },
    ...(profile.status === 'ACTIVE' ? {} : { robots: { index: false, follow: false } }),
    openGraph: { type: 'profile', title: profile.headline, description, url: `/dienstleistungen/${profile.id}` },
  };
}

export default function ServiceProfilePage({ params, searchParams }: PageProps<'/dienstleistungen/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-[36rem]" />}>
        <ProfileContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function ProfileContent({ params, searchParams }: Pick<PageProps<'/dienstleistungen/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, token] = await Promise.all([params, searchParams, getAccessToken()]);
  const profile = await loadProfile(id, token);
  if (!profile) notFound();
  const staff = token ? isStaff(await getCurrentUser()) : false;
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const publicView = profile.status === 'ACTIVE';
  const area = serviceAreaLabel(profile);
  const firstCategory = profile.categories[0];

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      {profile.isOwner || staff ? <OwnerBar profile={profile} staff={staff} /> : null}

      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/dienstleistungen" className="hover:text-brand-700 hover:underline">Dienstleistungen</Link>
        {firstCategory ? (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/dienstleistungen?bereich=${firstCategory.groupSlug}`} className="hover:text-brand-700 hover:underline">{firstCategory.groupName}</Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="size-20 shrink-0 overflow-hidden rounded-full border border-line bg-canvas sm:size-24">
                {profile.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                  <img src={profile.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center">
                    {profile.provider.business ? <Briefcase className="size-8 text-ink-300" aria-hidden="true" /> : <UserRound className="size-8 text-ink-300" aria-hidden="true" />}
                  </span>
                )}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">Anbieterprofil</Badge>
                  <Badge tone="neutral">{profile.provider.business ? 'Unternehmen' : 'Privatperson'}</Badge>
                  {!publicView ? <Badge tone="warning">{SERVICE_PROFILE_STATUS_LABELS[profile.status]}</Badge> : null}
                </div>
                <h1 className="mt-2 text-2xl leading-tight font-bold text-ink-950 sm:text-3xl">{profile.headline}</h1>
                <p className="mt-1 text-ink-600">{profile.provider.name}</p>
              </div>
            </div>
            <p className="mt-5 text-[0.9375rem] font-medium text-ink-800">{profile.summary}</p>

            <dl className="mt-5 grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
              {area ? (
                <div className="flex items-center gap-1.5">
                  {profile.remote && !profile.location && !profile.austriaWide ? <Globe className="size-4 shrink-0 text-ink-500" aria-hidden="true" /> : <MapPin className="size-4 shrink-0 text-ink-500" aria-hidden="true" />}
                  <dt className="sr-only">Einsatzgebiet</dt>
                  <dd>{area}</dd>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <CalendarClock className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                <dt className="sr-only">Verfügbarkeit</dt>
                <dd>
                  {SERVICE_AVAILABILITY_LABELS[profile.availability]}
                  {profile.availabilityNote ? ` – ${profile.availabilityNote}` : ''}
                </dd>
              </div>
              {profile.experienceYears !== null ? (
                <div className="flex items-center gap-1.5">
                  <Briefcase className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                  <dt className="sr-only">Erfahrung</dt>
                  <dd>{profile.experienceYears === 1 ? '1 Jahr Erfahrung' : `${profile.experienceYears} Jahre Erfahrung`} (laut Angabe)</dd>
                </div>
              ) : null}
              {profile.website ? (
                <div className="flex items-center gap-1.5">
                  <ExternalLink className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                  <dt className="sr-only">Website</dt>
                  <dd className="min-w-0 truncate">
                    <a href={profile.website} rel="nofollow noopener noreferrer ugc" target="_blank" className="font-semibold text-brand-700 hover:underline">
                      {new URL(profile.website).host}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>

            <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Kategorien">
              {profile.categories.map((c) => (
                <li key={c.slug}>
                  <Link href={`/dienstleistungen?kategorie=${c.slug}`} className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-900 hover:bg-brand-100">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
            {profile.skills.length ? (
              <>
                <h2 className="mt-6 font-sans text-base font-semibold tracking-normal">Fähigkeiten</h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {profile.skills.map((skill) => (
                    <li key={skill} className="rounded-full border border-line px-3 py-1 text-sm text-ink-700">{skill}</li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2 className="mt-8 font-sans text-lg font-semibold tracking-normal">Über das Angebot</h2>
            <div className="mt-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-800">{profile.description}</div>
          </Card>

          {profile.regulatedCategories.length ? (
            <Alert tone="info" title="Hinweis zu Berufsberechtigungen">
              Für {profile.regulatedCategories.join(', ')} kann in Österreich eine Gewerbeberechtigung bzw. ein Befähigungsnachweis nötig sein. MarktAT prüft Berechtigungen
              nicht automatisch. Ob ein Betrieb eingetragen ist, kannst du im{' '}
              <a href="https://www.gisa.gv.at/abfrage" rel="noopener noreferrer" target="_blank" className="font-semibold underline">
                GISA (Gewerbeinformationssystem Austria)
              </a>{' '}
              nachsehen.
            </Alert>
          ) : null}

          {profile.qualifications.length ? (
            <Card className="p-5 sm:p-7">
              <h2 className="font-sans text-lg font-semibold tracking-normal">Qualifikationen</h2>
              <ul className="mt-4 divide-y divide-line" data-testid="qualifications">
                {profile.qualifications.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">{q.title}</p>
                      {q.issuer ? <p className="text-sm text-ink-600">{q.issuer}</p> : null}
                      {q.reference ? <p className="text-xs text-ink-500">Nachweis: {q.reference}</p> : null}
                    </div>
                    {q.status === 'VERIFIED' ? (
                      <Badge tone="success">
                        <BadgeCheck className="size-3.5" aria-hidden="true" /> {QUALIFICATION_STATUS_LABELS.VERIFIED}
                        {q.reviewedAt ? ` am ${formatDate(q.reviewedAt)}` : ''}
                      </Badge>
                    ) : (
                      <Badge tone={q.status === 'REJECTED' ? 'danger' : 'neutral'}>{QUALIFICATION_STATUS_LABELS[q.status]}</Badge>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-500">„Von MarktAT geprüft“ heißt: Das Team hat den angegebenen Nachweis abgeglichen. Das ersetzt keine behördliche Bestätigung.</p>
            </Card>
          ) : null}

          {profile.portfolio.length ? (
            <Card className="p-5 sm:p-7">
              <h2 className="font-sans text-lg font-semibold tracking-normal">Arbeitsproben</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2" data-testid="portfolio">
                {profile.portfolio.map((item) => (
                  <li key={item.id} className="overflow-hidden rounded-xl border border-line">
                    <div className="aspect-[4/3] bg-canvas">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                        <img src={item.imageUrl} alt={item.title} className="size-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex size-full items-center justify-center">
                          <ImageIcon className="size-8 text-ink-300" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 p-3">
                      <p className="font-semibold text-ink-900">
                        {item.title}
                        {item.hidden ? <Badge tone="warning" className="ml-2">Vom Team ausgeblendet</Badge> : null}
                      </p>
                      {item.category ? <p className="text-xs text-ink-500">{item.category.name}</p> : null}
                      {item.description ? <p className="text-sm whitespace-pre-line text-ink-700">{item.description}</p> : null}
                      {item.url ? (
                        <a href={item.url} rel="nofollow noopener noreferrer ugc" target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                          Ansehen <ExternalLink className="size-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                      {item.imageRights ? (
                        <p className="text-xs text-ink-500">
                          Bild: {PORTFOLIO_IMAGE_RIGHTS_LABELS[item.imageRights]}
                          {item.imageCredit ? ` · ${item.imageCredit}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <p className="text-sm text-ink-500">Preisangabe</p>
            <p className="text-xl font-bold text-ink-950" data-testid="service-price">{servicePriceLabel(profile)}</p>
            <p className="mt-1 text-xs text-ink-500">Unverbindliche Angabe der Anbieterin bzw. des Anbieters. Das genaue Angebot vereinbart ihr direkt.</p>
            {profile.isOwner ? null : profile.conversationId ? (
              <Link href={`/nachrichten/${profile.conversationId}`} className={buttonClasses({ size: 'lg', className: 'mt-5 w-full' })}>
                <MessageCircle className="size-5" aria-hidden="true" /> Zur Unterhaltung
              </Link>
            ) : publicView ? (
              <ContactForm serviceProfileId={profile.id} sellerName={profile.provider.name} />
            ) : null}
            {!profile.isOwner && (publicView || profile.isFavorite) ? (
              <ItemFavoriteButton kind="service" id={profile.id} title={profile.headline} initial={profile.isFavorite} className="mt-3" />
            ) : null}
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              MarktAT vermittelt nicht und nimmt keine Provision. Vertrag, Leistung und Bezahlung vereinbart ihr direkt miteinander. Zahle nie vorab an Unbekannte.
            </p>
          </Card>

          {profile.imprint ? (
            <Card className="p-5 text-sm">
              <h2 className="font-sans text-base font-semibold tracking-normal">Angaben zum Unternehmen</h2>
              <dl className="mt-3 space-y-1 text-ink-700">
                <dt className="sr-only">Firmenname</dt>
                <dd className="font-semibold text-ink-900">{profile.imprint.companyName}</dd>
                {profile.imprint.companyAddress ? (
                  <>
                    <dt className="sr-only">Anschrift</dt>
                    <dd className="whitespace-pre-line">{profile.imprint.companyAddress}</dd>
                  </>
                ) : null}
                {profile.imprint.companyRegisterNumber ? <dd>Firmenbuch: {profile.imprint.companyRegisterNumber}</dd> : null}
                {profile.imprint.vatId ? <dd>UID: {profile.imprint.vatId}</dd> : null}
              </dl>
            </Card>
          ) : null}

          <p className="flex gap-2 px-1 text-xs text-ink-500">
            <BadgeInfo className="size-4 shrink-0" aria-hidden="true" />
            Mitglied seit {formatDate(profile.provider.memberSince)}. MarktAT zeigt keine Bewertungen.
          </p>
          {profile.isOwner ? null : (
            <Link href={`/melden?anbieter=${profile.id}`} className="flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-danger-600 hover:underline">
              <Flag className="size-4" aria-hidden="true" /> Profil melden
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function OwnerBar({ profile, staff }: { profile: ServiceProfileDetail; staff: boolean }) {
  return (
    <div className="space-y-3">
      {profile.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[profile.moderation.action]}>
          {profile.moderation.statement}{' '}
          {profile.isOwner ? (
            <Link href={`/konto/entscheidungen/${profile.moderation.decisionId}`} className="font-semibold underline">
              Begründung und Einspruch
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
        <span className="text-sm text-ink-700">
          Status: <strong>{SERVICE_PROFILE_STATUS_LABELS[profile.status]}</strong>
        </span>
        <span className="flex-1" />
        {profile.isOwner ? (
          <Link href="/konto/dienstleistungen" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <Pencil className="size-4" aria-hidden="true" /> Bearbeiten
          </Link>
        ) : null}
        {staff ? (
          <Link href={`/admin/dienstleistungen/${profile.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Moderieren
          </Link>
        ) : null}
      </div>
    </div>
  );
}
