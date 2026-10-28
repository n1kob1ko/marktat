import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { MapPin } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import type { DealStoreView } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { DeleteStoreButton, StoreForm } from '../forms';

export const metadata: Metadata = { title: 'Filialen', robots: { index: false } };

export default function StoresPage({ searchParams }: PageProps<'/konto/deals/filialen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Stores searchParams={searchParams} />
    </Suspense>
  );
}

async function Stores({ searchParams }: Pick<PageProps<'/konto/deals/filialen'>, 'searchParams'>) {
  const [{ user, token }, params] = await Promise.all([requireUser('/konto/deals/filialen'), searchParams]);
  if (user.accountType !== 'BUSINESS') {
    return <Card className="p-6 text-sm text-ink-700">Filialen gibt es nur für gewerbliche Konten.</Card>;
  }
  const stores = await api<DealStoreView[]>('/me/stores', { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const editId = typeof params.bearbeiten === 'string' ? params.bearbeiten : undefined;
  const editing = editId ? stores.find((s) => s.id === editId) : undefined;

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div>
        <Link href="/konto/deals" className="text-sm font-semibold text-brand-700 hover:underline">← Meine Deals</Link>
        <h2 className="mt-2 font-sans text-xl font-semibold tracking-normal">Filialen</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Für Angebote vor Ort: Wähle beim Deal aus, in welchen Filialen er gilt. Die Umkreissuche nutzt den Ortsmittelpunkt der PLZ, nicht die
          genaue Adresse.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div>
          {stores.length === 0 ? (
            <Card className="px-6 py-10 text-center text-sm text-ink-600">Noch keine Filialen angelegt.</Card>
          ) : (
            <ul className="space-y-3">
              {stores.map((store) => (
                <li key={store.id}>
                  <Card className="flex flex-wrap items-start gap-3 p-4">
                    <MapPin className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-ink-950">{store.name}</p>
                      <p className="text-ink-600">
                        {store.street}, {store.location.postalCode} {store.location.place} ({store.location.state})
                      </p>
                      {store.openingHours ? <p className="mt-1 text-ink-500">{store.openingHours}</p> : null}
                    </div>
                    <div className="flex gap-1">
                      <Link href={`/konto/deals/filialen?bearbeiten=${store.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                        Bearbeiten
                      </Link>
                      <DeleteStoreButton id={store.id} />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-500">Löschst du eine Filiale, werden Deals, die nur dort galten, pausiert.</p>
        </div>
        <Card className="space-y-4 p-5">
          <h3 className="font-sans text-base font-semibold tracking-normal">{editing ? 'Filiale bearbeiten' : 'Neue Filiale'}</h3>
          <StoreForm key={editing?.id ?? 'neu'} store={editing} />
          {editing ? (
            <Link href="/konto/deals/filialen" className="text-sm font-semibold text-brand-700 hover:underline">Abbrechen</Link>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
