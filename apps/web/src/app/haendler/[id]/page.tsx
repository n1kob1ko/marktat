import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeCheck, Globe, MapPin, MessageCircle, Phone, Store } from 'lucide-react';
import { Card, Container, Skeleton } from '@marktat/ui';
import { formatDate, type DealerProfile } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { ListingCard } from '@/components/listing-card';
import { Pagination } from '@/components/pagination';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadDealer(id: string, page = 1): Promise<DealerProfile | null> {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await api<DealerProfile>(`/dealers/${id}?seite=${page}`, { cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<'/haendler/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const dealer = await loadDealer(id).catch(() => null);
  if (!dealer) return { title: 'Händler nicht gefunden', robots: { index: false } };
  return {
    title: dealer.companyName,
    description: (dealer.description ?? `Aktuelle Angebote von ${dealer.companyName} auf MarktAT.`).slice(0, 155),
    alternates: { canonical: `/haendler/${dealer.id}` },
  };
}

export default function DealerPage({ params, searchParams }: PageProps<'/haendler/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Dealer params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Dealer({ params, searchParams }: PageProps<'/haendler/[id]'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Number.parseInt(typeof query.seite === 'string' ? query.seite : '1', 10) || 1);
  const dealer = await loadDealer(id, page);
  if (!dealer) notFound();
  const totalPages = Math.ceil(dealer.listings.total / dealer.listings.pageSize);
  const website = dealer.website ? new URL(dealer.website) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:gap-8">
      <aside className="space-y-4 lg:self-start">
        <Card className="p-5">
          {dealer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Logo ist serverseitig verkleinert (WebP 400 px)
            <img src={dealer.logoUrl} alt={`Logo von ${dealer.companyName}`} width={96} height={96} className="size-24 rounded-xl border border-line bg-surface object-contain" />
          ) : (
            <span className="flex size-24 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Store className="size-10" aria-hidden="true" />
            </span>
          )}
          <h1 className="mt-4 text-2xl font-bold text-ink-950">{dealer.companyName}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-brand-800">
            <BadgeCheck className="size-4" aria-hidden="true" /> Gewerblicher Anbieter
          </p>
          <p className="mt-1 text-sm text-ink-500">Auf MarktAT seit {formatDate(dealer.memberSince)}</p>
          {dealer.description ? <p className="mt-4 text-sm leading-relaxed whitespace-pre-line text-ink-700">{dealer.description}</p> : null}
          <ul className="mt-4 space-y-2 text-sm text-ink-700">
            {dealer.address ? (
              <li className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" /> {dealer.address}
              </li>
            ) : null}
            {website ? (
              <li className="flex gap-2">
                <Globe className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <a href={website.toString()} target="_blank" rel="noopener noreferrer nofollow" className="truncate font-semibold text-brand-700 hover:underline">
                  {website.host}
                </a>
              </li>
            ) : null}
            {dealer.phone ? (
              <li className="flex gap-2">
                <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <a href={`tel:${dealer.phone.replace(/[^+\d]/g, '')}`} className="font-semibold text-brand-700 hover:underline">
                  {dealer.phone}
                </a>
              </li>
            ) : null}
          </ul>
          <p className="mt-4 flex gap-2 rounded-lg bg-canvas p-3 text-sm text-ink-600">
            <MessageCircle className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
            Fragen zu einem Angebot? Schreib direkt über die jeweilige Anzeige – so bleiben deine Kontaktdaten geschützt.
          </p>
        </Card>
        {dealer.companyRegisterNumber || dealer.vatId ? (
          <Card className="p-5 text-sm">
            <h2 className="font-sans text-sm font-semibold tracking-normal text-ink-900">Anbieterkennzeichnung</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink-700">
              {dealer.companyRegisterNumber ? (
                <>
                  <dt className="text-ink-500">Firmenbuch</dt>
                  <dd>{dealer.companyRegisterNumber}</dd>
                </>
              ) : null}
              {dealer.vatId ? (
                <>
                  <dt className="text-ink-500">UID</dt>
                  <dd>{dealer.vatId}</dd>
                </>
              ) : null}
            </dl>
          </Card>
        ) : null}
      </aside>

      <section aria-labelledby="dealer-listings" className="min-w-0">
        <h2 id="dealer-listings" className="font-sans text-lg font-semibold tracking-normal">
          {dealer.activeListings.toLocaleString('de-AT')} {dealer.activeListings === 1 ? 'aktive Anzeige' : 'aktive Anzeigen'}
        </h2>
        {dealer.listings.items.length ? (
          <>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
              {dealer.listings.items.map((listing) => (
                <li key={listing.id} className="flex">
                  <ListingCard listing={listing} />
                </li>
              ))}
            </ul>
            <Pagination page={page} totalPages={totalPages} hrefFor={(p) => (p === 1 ? `/haendler/${dealer.id}` : `/haendler/${dealer.id}?seite=${p}`)} />
          </>
        ) : (
          <Card className="mt-4 px-6 py-12 text-center text-sm text-ink-600">
            Gerade keine aktiven Anzeigen. <Link href="/suche" className="font-semibold text-brand-700 hover:underline">Alle Anzeigen durchsuchen</Link>
          </Card>
        )}
      </section>
    </div>
  );
}
