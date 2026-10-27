import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, ExternalLink, ImageIcon } from 'lucide-react';
import { Alert, Badge, Field, Skeleton, Textarea } from '@marktat/ui';
import {
  formatDate,
  formatDateTime,
  PORTFOLIO_IMAGE_RIGHTS_LABELS,
  QUALIFICATION_STATUS_LABELS,
  REPORT_REASON_LABELS,
  SERVICE_AVAILABILITY_LABELS,
  type AdminServiceProfileDetail,
  type ServiceProfileStatus,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID, param } from '@/lib/admin';
import { servicePriceLabel, serviceAreaLabel } from '@/lib/services';
import { FlashMessage } from '@/components/flash-message';
import { SubmitButton } from '@/components/submit-button';
import { ServiceStatusBadge } from '@/components/services/service-status-badge';
import { DecisionList, PersonLink, ReportStatusBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { ActionForm, DecisionForm, type DecisionOption } from '@/components/admin/forms';
import { reviewQualificationAction } from '../../actions';

export const metadata: Metadata = { title: 'Anbieterprofil prüfen' };

/** Welche Entscheidung in welchem Status möglich ist (entspricht der Prüfung in der API) */
function decisionOptions(status: ServiceProfileStatus): DecisionOption[] {
  const options: DecisionOption[] = [];
  if (['ACTIVE', 'PAUSED', 'PENDING_REVIEW'].includes(status)) {
    options.push({
      value: 'REJECT',
      label: 'Ablehnen',
      description: 'Verstoß festgestellt (z. B. irreführende Angaben, unzulässige Tätigkeit). Das Profil verschwindet, offene Meldungen werden erledigt.',
      restrictive: true,
    });
  }
  if (['ACTIVE', 'PAUSED'].includes(status)) {
    options.push({ value: 'HIDE', label: 'Bis zur Prüfung ausblenden', description: 'Vorläufig: nicht mehr öffentlich, die Meldungen bleiben in Bearbeitung.', restrictive: true });
  }
  if (['REJECTED', 'PENDING_REVIEW'].includes(status)) {
    options.push({ value: 'RESTORE', label: 'Freigeben', description: 'Kein Verstoß (mehr). Das Profil ist wieder sichtbar.', restrictive: false });
  }
  return options;
}

const PORTFOLIO_HIDE: DecisionOption = {
  value: 'HIDE',
  label: 'Eintrag ausblenden',
  description: 'Nur dieser Eintrag verschwindet (z. B. fremdes Bild ohne Nutzungsrecht). Das Profil bleibt sichtbar.',
  restrictive: true,
};
const PORTFOLIO_RESTORE: DecisionOption = { value: 'RESTORE', label: 'Wieder zeigen', description: 'Der Eintrag ist wieder öffentlich sichtbar.', restrictive: false };

export default function AdminServicePage({ params, searchParams }: PageProps<'/admin/dienstleistungen/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <AdminService params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminService({ params, searchParams }: Pick<PageProps<'/admin/dienstleistungen/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/dienstleistungen/${id}`);
  let detail: AdminServiceProfileDetail;
  try {
    detail = await api<AdminServiceProfileDetail>(`/admin/services/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { profile, provider, qualifications, decisions, reports } = detail;
  const openReports = reports.filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW');
  const own = provider.id === user.id;
  const rows: [string, React.ReactNode][] = [
    ['Kategorien', profile.categories.map((c) => c.name).join(', ')],
    ['Einsatzgebiet', serviceAreaLabel(profile)],
    ['Preis', servicePriceLabel(profile)],
    ['Verfügbarkeit', `${SERVICE_AVAILABILITY_LABELS[profile.availability]}${profile.availabilityNote ? ` (${profile.availabilityNote})` : ''}`],
    ['Erfahrung', profile.experienceYears !== null ? `${profile.experienceYears} Jahre` : '–'],
    ['Website', profile.website ?? '–'],
    ['Veröffentlicht', profile.publishedAt ? formatDateTime(profile.publishedAt) : 'noch nicht'],
    ['Aufrufe', detail.viewCount.toLocaleString('de-AT')],
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/dienstleistungen" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Anbieterprofile
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ServiceStatusBadge status={profile.status} />
          {openReports.length ? <Badge tone="danger">{openReports.length} offene Meldung(en)</Badge> : null}
          {profile.regulatedCategories.length ? <Badge tone="warning">Berufsberechtigung möglich: {profile.regulatedCategories.join(', ')}</Badge> : null}
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal break-words text-ink-950">{profile.headline}</h2>
        <p className="text-sm text-ink-500">
          <Link href={`/dienstleistungen/${profile.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            Ansicht mit Team-Rechten <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section title="Angaben">
            <div className="flex flex-wrap items-start gap-4">
              {profile.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                <img src={profile.imageUrl} alt="Profilbild" className="size-20 rounded-full border border-line object-cover" />
              ) : null}
              <p className="min-w-0 flex-1 text-sm text-ink-800">{profile.summary}</p>
            </div>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="text-sm font-semibold break-words text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            {profile.skills.length ? <p className="mt-3 text-sm text-ink-600">Fähigkeiten: {profile.skills.join(', ')}</p> : null}
            <h4 className="mt-5 text-sm font-semibold text-ink-900">Beschreibung</h4>
            <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line text-ink-800">{profile.description}</p>
          </Section>

          <Section title={`Qualifikationen (${qualifications.length})`}>
            {qualifications.length ? (
              <ul className="divide-y divide-line" data-testid="admin-qualifications">
                {qualifications.map((q) => (
                  <li key={q.id} className="space-y-3 py-4 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold text-ink-900">{q.title}</p>
                        <p className="text-ink-600">{q.issuer ?? 'ohne Aussteller'} · Nachweis: {q.reference ?? 'keine Nummer angegeben'}</p>
                        {q.reviewedAt ? (
                          <p className="text-xs text-ink-500">
                            Geprüft {formatDate(q.reviewedAt)}
                            {q.reviewedBy ? ` von ${q.reviewedBy.displayName}` : ''}
                            {q.reviewNote ? ` – ${q.reviewNote}` : ''}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone={q.status === 'VERIFIED' ? 'success' : q.status === 'REJECTED' ? 'danger' : 'warning'}>{QUALIFICATION_STATUS_LABELS[q.status]}</Badge>
                    </div>
                    {own ? null : (
                      <ActionForm action={reviewQualificationAction}>
                        <input type="hidden" name="id" value={q.id} />
                        <input type="hidden" name="profileId" value={profile.id} />
                        <Field label="Notiz zur Prüfung" hint="z. B. „GISA-Abfrage vom … stimmt überein“. Die Person sieht das Ergebnis, nicht die Notiz.">
                          <Textarea name="note" rows={2} maxLength={500} className="min-h-16" />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          {q.status !== 'VERIFIED' ? (
                            <SubmitButton name="decision" value="VERIFY" size="sm">
                              Nachweis geprüft – bestätigen
                            </SubmitButton>
                          ) : null}
                          {q.status !== 'REJECTED' ? (
                            <SubmitButton name="decision" value="REJECT" size="sm" variant="outline">
                              Nicht bestätigen
                            </SubmitButton>
                          ) : null}
                        </div>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Qualifikationen angegeben.</p>
            )}
            <p className="mt-3 text-xs text-ink-500">
              Bestätigen nur nach Abgleich mit einer verlässlichen Quelle (z. B.{' '}
              <a href="https://www.gisa.gv.at/abfrage" rel="noopener noreferrer" target="_blank" className="underline">
                GISA
              </a>
              , Kammer- oder Berufsregister). Ohne Abgleich bleibt die Angabe „nicht geprüft“.
            </p>
          </Section>

          <Section title={`Portfolio (${profile.portfolio.length})`}>
            {profile.portfolio.length ? (
              <ul className="space-y-4" data-testid="admin-portfolio">
                {profile.portfolio.map((item) => (
                  <li key={item.id} className="space-y-3 rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
                        <img src={item.imageUrl} alt={item.title} className="h-20 w-28 rounded-lg bg-canvas object-cover" />
                      ) : (
                        <span className="flex h-20 w-28 items-center justify-center rounded-lg bg-canvas text-ink-300">
                          <ImageIcon className="size-6" aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold text-ink-900">
                          {item.title} {item.hidden ? <Badge tone="warning">Ausgeblendet</Badge> : null}
                        </p>
                        {item.description ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-ink-700">{item.description}</p> : null}
                        {item.imageRights ? (
                          <p className="mt-1 text-xs text-ink-500">
                            Bildrechte: {PORTFOLIO_IMAGE_RIGHTS_LABELS[item.imageRights]}
                            {item.imageCredit ? ` (${item.imageCredit})` : ''}
                          </p>
                        ) : null}
                        {item.url ? <p className="mt-1 text-xs break-all text-ink-500">Link: {item.url}</p> : null}
                      </div>
                    </div>
                    {own ? null : (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-brand-700">{item.hidden ? 'Wieder zeigen …' : 'Eintrag ausblenden …'}</summary>
                        <div className="mt-3">
                          <DecisionForm target="portfolioItem" id={item.id} hidden={{ profileId: profile.id }} options={[item.hidden ? PORTFOLIO_RESTORE : PORTFOLIO_HIDE]} />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Einträge.</p>
            )}
          </Section>

          <Section title={`Meldungen (${reports.length})`}>
            {reports.length ? (
              <ul className="divide-y divide-line text-sm">
                {reports.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/meldungen/${r.id}`} className="font-semibold text-brand-700 hover:underline">{REPORT_REASON_LABELS[r.reason]}</Link>
                      <ReportStatusBadge status={r.status} />
                      <span className="text-ink-500">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.details ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-ink-700">{r.details}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Meldungen.</p>
            )}
          </Section>

          <Section title="Entscheidungen">
            <DecisionList decisions={decisions} />
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="Anbieter:in">
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <PersonLink person={provider} />
                <UserStatusBadge status={provider.status} />
              </p>
              <p className="text-ink-600">{provider.business ? 'Gewerbliches Konto' : 'Privates Konto'} · seit {formatDate(provider.createdAt)}</p>
              {provider.email ? <p className="break-all text-ink-600">{provider.email}</p> : null}
              {profile.imprint ? (
                <p className="text-ink-600">
                  {profile.imprint.companyName}
                  {profile.imprint.companyAddress ? `, ${profile.imprint.companyAddress}` : ''}
                  {profile.imprint.companyRegisterNumber ? ` · FN ${profile.imprint.companyRegisterNumber}` : ''}
                  {profile.imprint.vatId ? ` · UID ${profile.imprint.vatId}` : ''}
                </p>
              ) : null}
            </div>
          </Section>
          <Section title="Entscheiden">
            {own ? (
              <Alert tone="warning">Über das eigene Profil entscheidet jemand anderer aus dem Team.</Alert>
            ) : (
              <DecisionForm target="serviceProfile" id={profile.id} version={detail.version} options={decisionOptions(profile.status)} defaultReason={openReports[0]?.reason} />
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
