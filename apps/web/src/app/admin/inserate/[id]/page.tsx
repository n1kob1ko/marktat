import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Alert, Badge, Skeleton } from '@marktat/ui';
import {
  categoryAttributeSchema,
  describeListingAttributes,
  formatDate,
  formatDateTime,
  REPORT_REASON_LABELS,
  type AdminListingDetail,
  type ListingStatus,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ENTITY_ID, param } from '@/lib/admin';
import { ListingGallery } from '@/components/listing-gallery';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { PriceTag } from '@/components/price-tag';
import { DecisionList, PersonLink, ReportStatusBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { DecisionForm, type DecisionOption } from '@/components/admin/forms';

export const metadata: Metadata = { title: 'Inserat prüfen' };

/** Welche Entscheidung in welchem Status möglich ist (entspricht der Prüfung in der API) */
function decisionOptions(status: ListingStatus): DecisionOption[] {
  const options: DecisionOption[] = [];
  if (['ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW'].includes(status)) {
    options.push({ value: 'REJECT', label: 'Deaktivieren', description: 'Verstoß festgestellt. Das Inserat verschwindet aus Suche und Detailansicht, offene Meldungen werden erledigt.', restrictive: true });
  }
  if (['ACTIVE', 'PAUSED', 'EXPIRED'].includes(status)) {
    options.push({ value: 'HIDE', label: 'Bis zur Prüfung ausblenden', description: 'Vorläufig: nicht mehr öffentlich, die Meldungen bleiben in Bearbeitung.', restrictive: true });
  }
  if (['REJECTED', 'PENDING_REVIEW'].includes(status)) {
    options.push({ value: 'RESTORE', label: 'Freigeben', description: 'Kein Verstoß (mehr). Das Inserat ist wieder sichtbar, sofern es nicht abgelaufen oder pausiert war.', restrictive: false });
  }
  return options;
}

export default function AdminListingPage({ params, searchParams }: PageProps<'/admin/inserate/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <AdminListing params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminListing({ params, searchParams }: Pick<PageProps<'/admin/inserate/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/inserate/${id}`);
  let detail: AdminListingDetail;
  try {
    detail = await api<AdminListingDetail>(`/admin/listings/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { listing, seller, decisions, reports } = detail;
  const openReports = reports.filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW');
  const ownListing = seller.id === user.id;
  const publiclyVisible = listing.status === 'ACTIVE' && seller.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <Link href="/admin/inserate" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Inserate
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ListingStatusBadge status={listing.status} />
          {openReports.length ? <Badge tone="danger">{openReports.length} offene Meldung(en)</Badge> : null}
          <Badge>{listing.category.name}</Badge>
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal break-words text-ink-950">{listing.title}</h2>
        <p className="text-sm text-ink-500">
          Erstellt {formatDateTime(listing.createdAt)}
          {listing.publishedAt ? ` · veröffentlicht ${formatDateTime(listing.publishedAt)}` : ''}
          {publiclyVisible ? (
            <>
              {' · '}
              <Link href={`/anzeige/${listing.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                Öffentliche Ansicht <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <ListingGallery images={listing.images} title={listing.title} />
          <Section title="Angaben">
            <PriceTag priceType={listing.priceType} priceCents={listing.priceCents} suffix={listing.priceSuffix} salary={listing.vertical === 'JOBS' ? listing.salary : undefined} className="text-2xl" />
            {listing.location ? <p className="mt-2 text-sm text-ink-600">{listing.location.postalCode} {listing.location.place}, {listing.location.state}</p> : null}
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {describeListingAttributes(categoryAttributeSchema(listing.category.path), listing.attributes).map((item) => (
                <div key={item.key} className="min-w-0 rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-xs text-ink-500">{item.label}</dt>
                  <dd className="text-sm font-semibold break-words text-ink-900">{item.values ? item.values.join(', ') : item.value}</dd>
                </div>
              ))}
            </dl>
            <h4 className="mt-5 text-sm font-semibold text-ink-900">Beschreibung</h4>
            <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line text-ink-800">{listing.description || '–'}</p>
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
          <Section title="Anbieter">
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <PersonLink person={seller} />
                <UserStatusBadge status={seller.status} />
              </p>
              {seller.email ? <p className="break-all text-ink-600">{seller.email}</p> : null}
              <p className="text-ink-500">Mitglied seit {formatDate(seller.createdAt)}</p>
            </div>
          </Section>
          <Section title="Entscheiden">
            {ownListing ? (
              <Alert tone="warning">Über eigene Inserate entscheidet jemand anderer aus dem Team.</Alert>
            ) : (
              <DecisionForm target="listing" id={listing.id} version={detail.version} options={decisionOptions(listing.status)} defaultReason={openReports[0]?.reason} />
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
