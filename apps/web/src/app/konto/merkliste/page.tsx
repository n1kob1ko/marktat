import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Heart, ImageOff } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatDate, type FavoriteItem, type Paginated } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ListingCard } from '@/components/listing-card';
import { SubmitButton } from '@/components/submit-button';
import { removeFavoriteAction } from '@/components/favorites/actions';

export const metadata: Metadata = { title: 'Merkliste', robots: { index: false } };

export default function FavoritesPage({ searchParams }: PageProps<'/konto/merkliste'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Favorites searchParams={searchParams} />
    </Suspense>
  );
}

async function Favorites({ searchParams }: Pick<PageProps<'/konto/merkliste'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireUser('/konto/merkliste'), searchParams]);
  const page = Math.max(Number.parseInt(typeof params.seite === 'string' ? params.seite : '1', 10) || 1, 1);
  const result = await api<Paginated<FavoriteItem>>(`/me/favorites?seite=${page}`, { token, cache: 'no-store' });
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const fehler = typeof params.fehler === 'string' ? params.fehler : undefined;
  const available = result.items.filter((item) => item.available);
  const gone = result.items.filter((item) => !item.available);
  const totalPages = Math.ceil(result.total / result.pageSize);

  return (
    <div className="space-y-5">
      <FlashMessage hinweis={hinweis} fehler={fehler} />
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

      {totalPages > 1 ? (
        <nav aria-label="Seiten" className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link href={`/konto/merkliste?seite=${page - 1}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              Zurück
            </Link>
          ) : null}
          <span className="text-sm text-ink-600">
            Seite {page} von {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/konto/merkliste?seite=${page + 1}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              Weiter
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
