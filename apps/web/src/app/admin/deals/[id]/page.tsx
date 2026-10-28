import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Alert, Badge, Field, Input, Skeleton, Textarea } from '@marktat/ui';
import {
  DEAL_AVAILABILITY_LABELS,
  DEAL_CHANNEL_LABELS,
  DEAL_IMAGE_RIGHTS_LABELS,
  DEAL_SOURCE_LABELS,
  formatDate,
  formatDateTime,
  formatPriceCents,
  REFERENCE_PRICE_LABELS,
  REPORT_REASON_LABELS,
  type AdminDealDetail,
  type DealDisplayStatus,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID, param } from '@/lib/admin';
import { FlashMessage } from '@/components/flash-message';
import { SubmitButton } from '@/components/submit-button';
import { StepUpField } from '@/components/security/step-up-field';
import { DealStatusBadge } from '@/components/deals/deal-status-badge';
import { DecisionList, PersonLink, ReportStatusBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { ActionForm, DecisionForm, type DecisionOption } from '@/components/admin/forms';
import { assignDealMerchantAction } from '../../actions';

export const metadata: Metadata = { title: 'Deal prüfen' };

/** Welche Entscheidung in welchem Status möglich ist (entspricht der Prüfung in der API; „geplant“, „unbestätigt“ und „ausverkauft“ sind aktiv) */
function decisionOptions(display: DealDisplayStatus): DecisionOption[] {
  const status = display === 'SCHEDULED' || display === 'UNVERIFIED' || display === 'SOLD_OUT' ? 'ACTIVE' : display;
  const options: DecisionOption[] = [];
  if (['ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW'].includes(status)) {
    options.push({
      value: 'REJECT',
      label: 'Ablehnen',
      description: 'Verstoß festgestellt (z. B. irreführender Vergleichspreis). Der Deal verschwindet, offene Meldungen werden erledigt.',
      restrictive: true,
    });
  }
  if (['ACTIVE', 'PAUSED', 'EXPIRED'].includes(status)) {
    options.push({ value: 'HIDE', label: 'Bis zur Prüfung ausblenden', description: 'Vorläufig: nicht mehr öffentlich, die Meldungen bleiben in Bearbeitung.', restrictive: true });
  }
  if (['REJECTED', 'PENDING_REVIEW'].includes(status)) {
    options.push({ value: 'RESTORE', label: 'Freigeben', description: 'Kein Verstoß (mehr). Der Deal ist wieder sichtbar, sofern er nicht abgelaufen oder pausiert war.', restrictive: false });
  }
  return options;
}

export default function AdminDealPage({ params, searchParams }: PageProps<'/admin/deals/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <AdminDeal params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminDeal({ params, searchParams }: Pick<PageProps<'/admin/deals/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/deals/${id}`);
  let detail: AdminDealDetail;
  try {
    detail = await api<AdminDealDetail>(`/admin/deals/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { deal, merchant, decisions, reports, duplicates } = detail;
  const openReports = reports.filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW');
  const own = merchant.id === user.id;
  const isAdmin = user.role === 'ADMIN';
  const stepUp = { enabled: user.security?.level === 'aal2', maxAgeMinutes: user.security?.stepUpMaxAgeMinutes ?? 10 };
  const rows: [string, React.ReactNode][] = [
    ['Kategorie', deal.category.name],
    ['Kanal', DEAL_CHANNEL_LABELS[deal.channel]],
    ['Gültig', `${formatDate(deal.startsAt)} – ${formatDate(deal.endsAt)}`],
    ['Zuletzt bestätigt', deal.lastVerifiedAt ? formatDateTime(deal.lastVerifiedAt) : 'nie'],
    ['Verfügbarkeit', DEAL_AVAILABILITY_LABELS[deal.availability]],
    ['Herkunft', DEAL_SOURCE_LABELS[deal.source]],
    ['Bildrechte', deal.imageRights ? `${DEAL_IMAGE_RIGHTS_LABELS[deal.imageRights]}${deal.imageCredit ? ` (${deal.imageCredit})` : ''}` : 'kein Bild'],
    ['Link', deal.url ? `${deal.urlHost ?? ''}${deal.isAffiliateLink ? ' · Werbelink' : ''}` : '–'],
    [
      'Linkprüfung',
      `${deal.linkStatus === 'BROKEN' ? 'defekt' : deal.linkStatus === 'OK' ? 'erreichbar' : 'noch nicht geprüft'}${detail.linkCheckedAt ? ` (${formatDateTime(detail.linkCheckedAt)}, ${detail.linkFailures} Fehler in Folge)` : ''}`,
    ],
    ['Aufrufe / Klicks', `${detail.viewCount.toLocaleString('de-AT')} / ${detail.clickCount.toLocaleString('de-AT')}`],
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/deals" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Deals
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DealStatusBadge status={deal.status} />
          {openReports.length ? <Badge tone="danger">{openReports.length} offene Meldung(en)</Badge> : null}
          {deal.discountPercent !== null && deal.discountPercent >= 50 ? <Badge tone="warning">Hoher Rabatt</Badge> : null}
          {duplicates.length ? <Badge tone="warning">{duplicates.length} mögliche Doppelte</Badge> : null}
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal break-words text-ink-950">{deal.title}</h2>
        <p className="text-sm text-ink-500">
          {deal.publishedAt ? `Veröffentlicht ${formatDateTime(deal.publishedAt)} · ` : ''}
          <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            Ansicht mit Team-Rechten <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section title="Preis">
            <p className="text-2xl font-bold text-ink-950">{formatPriceCents(deal.priceCents)}</p>
            {deal.referencePriceCents !== null && deal.referencePriceType ? (
              <div className="mt-2 space-y-1 text-sm text-ink-700">
                <p>
                  Vergleichspreis: <strong>{formatPriceCents(deal.referencePriceCents)}</strong> ({REFERENCE_PRICE_LABELS[deal.referencePriceType]})
                  {deal.discountPercent !== null ? ` → −${deal.discountPercent} %` : ''}
                </p>
                <p>Quelle laut Händler: {deal.referencePriceSource || '–'}</p>
                {deal.referencePriceEvidenceUrl ? (
                  <p>
                    Beleg:{' '}
                    <a href={deal.referencePriceEvidenceUrl} rel="nofollow noopener noreferrer" target="_blank" className="break-all text-brand-700 hover:underline">
                      {deal.referencePriceEvidenceUrl}
                    </a>
                  </p>
                ) : (
                  <p className="text-ink-500">Kein Beleg-Link angegeben.</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-500">Kein Vergleichspreis, kein Rabatt.</p>
            )}
            {deal.priceHistory.length ? (
              <p className="mt-3 text-sm text-ink-600">
                Bei MarktAT erfasste Preise: {deal.priceHistory.map((p) => `${formatPriceCents(p.priceCents)} (${formatDate(p.recordedAt)})`).join(' · ')}
              </p>
            ) : null}
          </Section>

          <Section title="Angaben">
            <dl className="grid gap-2 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="text-sm font-semibold break-words text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            {deal.url ? (
              <p className="mt-3 text-sm break-all text-ink-600">
                Ziel: <span className="font-mono text-xs">{deal.url}</span>
              </p>
            ) : null}
            {deal.stores.length ? (
              <p className="mt-3 text-sm text-ink-600">Filialen: {deal.stores.map((s) => `${s.name} (${s.location.postalCode} ${s.location.place})`).join(', ')}</p>
            ) : null}
            <h4 className="mt-5 text-sm font-semibold text-ink-900">Beschreibung</h4>
            <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line text-ink-800">{deal.description || '–'}</p>
          </Section>

          {duplicates.length ? (
            <Section title="Mögliche Doppelte (gleicher Händler, gleicher Titel)">
              <ul className="divide-y divide-line text-sm">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Link href={`/admin/deals/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline">{d.title}</Link>
                    <DealStatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

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
          <Section title="Händler">
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <PersonLink person={merchant} />
                <UserStatusBadge status={merchant.status} />
                {merchant.dealsBlockedAt ? <Badge tone="danger">Für Deals gesperrt</Badge> : null}
              </p>
              {merchant.companyName ? <p className="text-ink-700">{merchant.companyName}</p> : null}
              <p className="text-ink-500">
                {merchant.eligibility.certified ? 'Angaben bestätigt (Art. 30 DSA)' : 'Angaben nicht bestätigt'}
                {merchant.eligibility.missingFields.length ? ` · fehlt: ${merchant.eligibility.missingFields.join(', ')}` : ''}
              </p>
              <p>
                <Link href={`/admin/deals?merchant=${merchant.id}&filter=all`} className="font-semibold text-brand-700 hover:underline">Alle Deals dieses Händlers</Link>
              </p>
            </div>
          </Section>
          <Section title="Entscheiden">
            {own ? (
              <Alert tone="warning">Über eigene Angebote entscheidet jemand anderer aus dem Team.</Alert>
            ) : (
              <DecisionForm target="deal" id={deal.id} version={detail.version} options={decisionOptions(deal.status)} defaultReason={openReports[0]?.reason} />
            )}
          </Section>
          {isAdmin ? (
            <Section title="Anderem Händlerkonto zuordnen">
              <ActionForm action={assignDealMerchantAction}>
                <input type="hidden" name="id" value={deal.id} />
                <p className="text-sm text-ink-600">
                  Nur wenn der Deal nachweislich einem anderen gewerblichen Konto gehört. Filialen werden entfernt, lokale Deals pausiert.
                </p>
                <Field label="Konto-ID des neuen Händlers">
                  <Input name="merchantId" placeholder="UUID" autoComplete="off" />
                </Field>
                <Field label="Begründung (intern, Protokoll)">
                  <Textarea name="note" rows={2} maxLength={500} className="min-h-20" />
                </Field>
                <StepUpField {...stepUp} />
                <SubmitButton variant="outline" size="sm">Zuordnen</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
