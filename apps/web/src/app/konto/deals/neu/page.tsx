import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Card, Skeleton } from '@marktat/ui';
import type { DealerEligibility, DealStoreView } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getDealCategories } from '@/lib/data';
import { DealForm } from '@/components/deals/deal-form';

export const metadata: Metadata = { title: 'Neues Angebot', robots: { index: false } };

export default function NewDealPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <NewDeal />
    </Suspense>
  );
}

async function NewDeal() {
  const { user, token } = await requireUser('/konto/deals/neu');
  if (user.accountType !== 'BUSINESS') {
    return (
      <Card className="p-6 text-sm text-ink-700">
        Deals können nur gewerbliche Konten einstellen. <Link href="/konto/deals" className="font-semibold text-brand-700 hover:underline">Mehr dazu</Link>
      </Card>
    );
  }
  const [categories, stores, eligibility] = await Promise.all([
    getDealCategories(),
    api<DealStoreView[]>('/me/stores', { token, cache: 'no-store' }),
    api<DealerEligibility>('/me/dealer-eligibility', { token, cache: 'no-store' }),
  ]);
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/konto/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Meine Deals</Link>
        <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal">Neues Angebot</h2>
        <p className="mt-1 text-sm text-ink-600">Das Produktbild lädst du nach dem ersten Speichern hoch.</p>
      </div>
      {!eligibility.eligible ? (
        <Card className="p-4 text-sm text-ink-700">
          Du kannst einen Entwurf anlegen. Zum Veröffentlichen fehlen noch Voraussetzungen –{' '}
          <Link href="/konto/deals" className="font-semibold text-brand-700 hover:underline">siehe Meine Deals</Link>.
        </Card>
      ) : null}
      <Card className="p-5 sm:p-7">
        <DealForm categories={categories} stores={stores} canPublish={eligibility.eligible} />
      </Card>
    </div>
  );
}
