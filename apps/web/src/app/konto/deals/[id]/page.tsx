import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Eye } from 'lucide-react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import {
  DEAL_MAX_DURATION_DAYS,
  formatDateTime,
  MODERATION_ACTION_LABELS,
  toViennaDay,
  type DealDetail,
  type DealerEligibility,
  type DealStoreView,
  type MerchantDealOverview,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getDealCategories } from '@/lib/data';
import { FlashMessage } from '@/components/flash-message';
import { DealActions } from '@/components/deals/deal-actions';
import { DealForm } from '@/components/deals/deal-form';
import { DealImageUpload } from '@/components/deals/deal-image-upload';
import { DealStatusBadge } from '@/components/deals/deal-status-badge';
import { ExtendDealForm } from '../forms';

export const metadata: Metadata = { title: 'Angebot verwalten', robots: { index: false } };

const ENTITY_ID = /^[a-z0-9]{20,40}$/;

/** Spätestes Enddatum beim Verlängern: Laufzeit höchstens DEAL_MAX_DURATION_DAYS ab Beginn bzw. ab heute (wie in der API) */
function latestEndDay(startsAt: string) {
  const from = Math.max(Date.now(), new Date(startsAt).getTime());
  return toViennaDay(new Date(from + (DEAL_MAX_DURATION_DAYS - 1) * 86_400_000));
}

export default function ManageDealPage({ params, searchParams }: PageProps<'/konto/deals/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <ManageDeal params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ManageDeal({ params, searchParams }: PageProps<'/konto/deals/[id]'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { token } = await requireUser(`/konto/deals/${id}`);
  let deal: DealDetail;
  try {
    deal = await api<DealDetail>(`/deals/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (!deal.isOwner) notFound();
  const [categories, stores, eligibility, overview] = await Promise.all([
    getDealCategories(),
    api<DealStoreView[]>('/me/stores', { token, cache: 'no-store' }),
    api<DealerEligibility>('/me/dealer-eligibility', { token, cache: 'no-store' }),
    api<MerchantDealOverview>('/me/deals', { token, cache: 'no-store' }),
  ]);
  const own = overview.deals.find((d) => d.id === id);
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const endsOn = toViennaDay(new Date(deal.endsAt));
  const maxEndsOn = latestEndDay(deal.startsAt);
  const canExtend = ['ACTIVE', 'PAUSED', 'EXPIRED', 'UNVERIFIED', 'SCHEDULED', 'SOLD_OUT'].includes(deal.status);

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/konto/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Meine Deals</Link>
          <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal break-words">{deal.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <DealStatusBadge status={deal.status} />
            {deal.lastVerifiedAt ? <span>Zuletzt geprüft am {formatDateTime(deal.lastVerifiedAt)}</span> : null}
            {own ? (
              <span>
                {own.viewCount.toLocaleString('de-AT')} Aufrufe · {own.clickCount.toLocaleString('de-AT')} Klicks auf „Zum Angebot“
              </span>
            ) : null}
          </div>
        </div>
        <Link href={`/deals/${deal.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Eye className="size-4" aria-hidden="true" /> Ansehen
        </Link>
      </div>

      {deal.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[deal.moderation.action]}>
          {deal.moderation.statement}{' '}
          <Link href={`/konto/entscheidungen/${deal.moderation.decisionId}`} className="font-semibold underline">
            Begründung und Einspruch
          </Link>
        </Alert>
      ) : deal.reviewReason && deal.status === 'PENDING_REVIEW' ? (
        <Alert tone="info" title="In Prüfung">{deal.reviewReason}</Alert>
      ) : null}
      {deal.linkStatus === 'BROKEN' ? (
        <Alert tone="danger" title="Der Link zum Angebot ist nicht erreichbar">
          Unsere Prüfung hat mehrmals keine Seite gefunden (404/410). Bitte korrigiere den Link – danach erscheint der Deal wieder.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="order-2 p-5 sm:p-7 lg:order-1">
          <DealForm categories={categories} stores={stores} deal={deal} externalId={own?.externalId ?? null} canPublish={eligibility.eligible} />
        </Card>
        <div className="order-1 space-y-4 lg:order-2">
          <Card className="space-y-3 p-5">
            <h3 className="font-sans text-base font-semibold tracking-normal">Status</h3>
            <DealActions id={deal.id} status={deal.status} />
          </Card>
          <Card className="space-y-3 p-5">
            <h3 className="font-sans text-base font-semibold tracking-normal">Produktbild</h3>
            <DealImageUpload dealId={deal.id} imageUrl={deal.imageUrl} rights={deal.imageRights} credit={deal.imageCredit} />
          </Card>
          {canExtend ? (
            <Card className="space-y-3 p-5">
              <h3 className="font-sans text-base font-semibold tracking-normal">Laufzeit verlängern</h3>
              <ExtendDealForm id={deal.id} endsOn={endsOn} maxEndsOn={maxEndsOn} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
