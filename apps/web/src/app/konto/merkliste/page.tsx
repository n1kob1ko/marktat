import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { Heart, ImageOff } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatDate, type DealFavoriteItem, type FavoriteItem, type Paginated, type ServiceFavoriteItem } from '@marktat/shared';
import { cn } from '@marktat/ui';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ListingCard } from '@/components/listing-card';
import { SubmitButton } from '@/components/submit-button';
import { DealCard } from '@/components/deals/deal-card';
import { ServiceCard } from '@/components/services/service-card';
import { removeFavoriteAction, removeItemFavoriteAction } from '@/components/favorites/actions';

const TABS = [
  { art: 'anzeigen', label: 'Anzeigen' },
  { art: 'deals', label: 'Deals' },
  { art: 'anbieter', label: 'Anbieter' },
] as const;
type Tab = (typeof TABS)[number]['art'];

export const metadata: Metadata = { title: 'Merkliste', robots: { index: false } };

export default function FavoritesPage({ searchParams }: PageProps<'/konto/merkliste'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Favorites searchParams={searchParams} />
    </Suspense>
  );
}

async function Favorites({ searchParams }: Pick<PageProps<'/konto/merkliste'>, 'searchParams'>) {
  const params = await searchParams;
  const tab: Tab = TABS.find((t) => t.art === params.art)?.art ?? 'anzeigen';
  const { token } = await requireUser(tab === 'anzeigen' ? '/konto/merkliste' : `/konto/merkliste?art=${tab}`);
  const page = Math.max(Number.parseInt(typeof params.seite === 'string' ? params.seite : '1', 10) || 1, 1);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;

  return (
    <div className="space-y-5">
      <FlashMessage hinweis={hinweis} fehler={fehler} />
      <nav aria-label="Merkliste" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => (
          <Link
            key={t.art}
            href={t.art === 'anzeigen' ? '/konto/merkliste' : `/konto/merkliste?art=${t.art}`}
            aria-current={t.art === tab ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold whitespace-nowrap transition-colors',
              t.art === tab ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-900/5',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'deals' ? <DealFavorites token={token} page={page} /> : tab === 'anbieter' ? <ServiceFavorites token={token} page={page} /> : <ListingFavorites token={token} page={page} />}
    </div>
  );
}

async function ListingFavorites({ token, page }: { token: string; page: number }) {
  const result = await api<Paginated<FavoriteItem>>(`/me/favorites?seite=${page}`, { token, cache: 'no-store' });
  const available = result.items.filter((item) => item.available);
  const gone = result.items.filter((item) => !item.available);
  const totalPages = Math.ceil(result.total / result.pageSize);

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600">
        {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'gemerkte Anzeige' : 'gemerkte Anzeigen'}
      </p>

      {result.total === 0 ? (
        <Card className="px-6 py-12 text-center">
          <Heart className="mx-auto size-8 text-ink-300" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink-900">Deine Merkliste ist leer</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
            Tippe bei einer Anzeige auf das Herz, um sie hier zu sammeln. Die Liste bleibt auch nach dem Abmelden erhalten.
          </p>
          <Link href="/suche" className={buttonClasses({ variant: 'outline', className: 'mt-5' })}>
            Anzeigen entdecken
          </Link>
        </Card>
      ) : null}

      {available.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {available.map((item) => (
            <li key={item.listing.id} className="flex">
              <ListingCard listing={item.listing} favorite />
            </li>
          ))}
        </ul>
      ) : null}

      {gone.length ? (
        <section aria-labelledby="gone-heading" className="space-y-3">
          <h2 id="gone-heading" className="font-sans text-base font-semibold tracking-normal text-ink-900">
            Nicht mehr verfügbar
          </h2>
          <ul className="space-y-2">
            {gone.map((item) => (
              <li key={item.listing.id}>
                <Card className="flex items-center gap-4 p-3 sm:p-4" data-testid="favorite-unavailable">
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-canvas">
                    <ImageOff className="size-5 text-ink-300" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-500 line-through decoration-ink-300">{item.listing.title}</p>
                    <p className="text-xs text-ink-500">
                      Verkauft, pausiert oder abgelaufen · gemerkt am {formatDate(item.savedAt)}
                    </p>
                  </div>
                  <form action={removeFavoriteAction}>
                    <input type="hidden" name="listingId" value={item.listing.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Entfernen
                    </SubmitButton>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Pager page={page} totalPages={totalPages} base="/konto/merkliste" />
    </div>
  );
}

function Pager({ page, totalPages, base }: { page: number; totalPages: number; base: string }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => `${base}${base.includes('?') ? '&' : '?'}seite=${p}`;
  return (
    <nav aria-label="Seiten" className="flex items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Zurück
        </Link>
      ) : null}
      <span className="text-sm text-ink-600">
        Seite {page} von {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Weiter
        </Link>
      ) : null}
    </nav>
  );
}

function RemoveItemForm({ kind, id, title }: { kind: 'deal' | 'service'; id: string; title: string }) {
  return (
    <form action={removeItemFavoriteAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" aria-label={`„${title}“ von der Merkliste entfernen`}>
        Entfernen
      </SubmitButton>
    </form>
  );
}

function EmptyTab({ title, text, href, cta }: { title: string; text: string; href: string; cta: string }) {
  return (
    <Card className="px-6 py-12 text-center">
      <Heart className="mx-auto size-8 text-ink-300" aria-hidden="true" />
      <p className="mt-3 font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{text}</p>
      <Link href={href} className={buttonClasses({ variant: 'outline', className: 'mt-5' })}>
        {cta}
      </Link>
    </Card>
  );
}

function UnavailableRow({ title, savedAt, note, children }: { title: string; savedAt: string; note: string; children: ReactNode }) {
  return (
    <Card className="flex items-center gap-4 p-3 sm:p-4" data-testid="favorite-unavailable">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-canvas">
        <ImageOff className="size-5 text-ink-300" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink-500 line-through decoration-ink-300">{title}</p>
        <p className="text-xs text-ink-500">
          {note} · gemerkt am {formatDate(savedAt)}
        </p>
      </div>
      {children}
    </Card>
  );
}

async function DealFavorites({ token, page }: { token: string; page: number }) {
  const result = await api<Paginated<DealFavoriteItem>>(`/me/favorites/deals?seite=${page}`, { token, cache: 'no-store' });
  const available = result.items.filter((item) => item.available);
  const gone = result.items.filter((item) => !item.available);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600">
        {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'gemerkter Deal' : 'gemerkte Deals'}
      </p>
      {result.total === 0 ? (
        <EmptyTab title="Noch keine Deals gemerkt" text="Tippe bei einem Angebot auf „Merken“, um es hier wiederzufinden. Abgelaufene Angebote bleiben ausgegraut stehen, bis du sie entfernst." href="/deals" cta="Deals entdecken" />
      ) : null}
      {available.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {available.map((item) => (
            <li key={item.deal.id} className="flex flex-col gap-1">
              <DealCard deal={item.deal} className="flex-1" />
              <RemoveItemForm kind="deal" id={item.deal.id} title={item.deal.title} />
            </li>
          ))}
        </ul>
      ) : null}
      {gone.length ? (
        <section aria-labelledby="gone-deals-heading" className="space-y-3">
          <h2 id="gone-deals-heading" className="font-sans text-base font-semibold tracking-normal text-ink-900">
            Nicht mehr verfügbar
          </h2>
          <ul className="space-y-2">
            {gone.map((item) => (
              <li key={item.deal.id}>
                <UnavailableRow title={item.deal.title} savedAt={item.savedAt} note="Abgelaufen, beendet oder entfernt">
                  <RemoveItemForm kind="deal" id={item.deal.id} title={item.deal.title} />
                </UnavailableRow>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Pager page={page} totalPages={Math.ceil(result.total / result.pageSize)} base="/konto/merkliste?art=deals" />
    </div>
  );
}

async function ServiceFavorites({ token, page }: { token: string; page: number }) {
  const result = await api<Paginated<ServiceFavoriteItem>>(`/me/favorites/services?seite=${page}`, { token, cache: 'no-store' });
  const available = result.items.filter((item) => item.available);
  const gone = result.items.filter((item) => !item.available);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600">
        {result.total.toLocaleString('de-AT')} {result.total === 1 ? 'gemerkter Anbieter' : 'gemerkte Anbieter'}
      </p>
      {result.total === 0 ? (
        <EmptyTab title="Noch keine Anbieter gemerkt" text="Tippe in einem Anbieterprofil auf „Merken“, um es hier wiederzufinden." href="/dienstleistungen" cta="Dienstleistungen entdecken" />
      ) : null}
      {available.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {available.map((item) => (
            <li key={item.profile.id} className="flex flex-col gap-1">
              <ServiceCard profile={item.profile} className="flex-1" />
              <RemoveItemForm kind="service" id={item.profile.id} title={item.profile.headline} />
            </li>
          ))}
        </ul>
      ) : null}
      {gone.length ? (
        <section aria-labelledby="gone-services-heading" className="space-y-3">
          <h2 id="gone-services-heading" className="font-sans text-base font-semibold tracking-normal text-ink-900">
            Nicht mehr verfügbar
          </h2>
          <ul className="space-y-2">
            {gone.map((item) => (
              <li key={item.profile.id}>
                <UnavailableRow title={item.profile.headline} savedAt={item.savedAt} note="Pausiert oder in Prüfung">
                  <RemoveItemForm kind="service" id={item.profile.id} title={item.profile.headline} />
                </UnavailableRow>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Pager page={page} totalPages={Math.ceil(result.total / result.pageSize)} base="/konto/merkliste?art=anbieter" />
    </div>
  );
}
