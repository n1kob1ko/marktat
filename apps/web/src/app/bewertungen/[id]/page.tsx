import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Flag, Star, Store, UserRound } from 'lucide-react';
import { Card, Container, Skeleton } from '@marktat/ui';
import { formatDate, type PublicRatings } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { Pagination } from '@/components/pagination';
import { FlashMessage } from '@/components/flash-message';
import { formatAverage, RatingDistribution, Stars } from '@/components/ratings/rating-stars';
import { RatingEntry, RatingsTransparencyNote } from '@/components/ratings/rating-list';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadRatings(id: string, page = 1): Promise<PublicRatings | null> {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await api<PublicRatings>(`/users/${id}/ratings?page=${page}`, { cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/bewertungen/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const data = await loadRatings(id).catch(() => null);
  if (!data) return { title: 'Bewertungen', robots: { index: false } };
  const { summary, user } = data;
  return {
    title: `Bewertungen von ${user.displayName}`,
    description: summary.count
      ? `${user.displayName} hat ${summary.count} ${summary.count === 1 ? 'Bewertung' : 'Bewertungen'} mit durchschnittlich ${formatAverage(summary.average ?? 0)} von 5 Sternen auf Markterl.`
      : `${user.displayName} hat noch keine Bewertungen auf Markterl.`,
    alternates: { canonical: `/bewertungen/${user.id}` },
  };
}

export default function RatingsPage({ params, searchParams }: PageProps<'/bewertungen/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Ratings params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Ratings({
  params,
  searchParams,
}: Pick<PageProps<'/bewertungen/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page = Math.max(
    1,
    Number.parseInt(typeof query.seite === 'string' ? query.seite : '1', 10) || 1,
  );
  const data = await loadRatings(id, page);
  if (!data) notFound();
  const { user, summary, items, total, pageSize } = data;
  const totalPages = Math.ceil(total / pageSize);
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr] lg:gap-8">
      <aside className="space-y-4 lg:self-start">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              {user.accountType === 'BUSINESS' ? (
                <Store className="size-6" aria-hidden="true" />
              ) : (
                <UserRound className="size-6" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-sans text-xl font-bold tracking-normal text-ink-950">
                {user.displayName}
              </h1>
              <p className="text-sm text-ink-500">Mitglied seit {formatDate(user.memberSince)}</p>
            </div>
          </div>
          {summary.count && summary.average !== null ? (
            <div className="mt-5">
              <p className="flex items-center gap-3">
                <span className="text-4xl font-bold text-ink-950">
                  {formatAverage(summary.average)}
                </span>
                <span>
                  <Stars value={summary.average} size="md" />
                  <span className="block text-sm text-ink-500">
                    {summary.count} {summary.count === 1 ? 'Bewertung' : 'Bewertungen'}
                  </span>
                </span>
              </p>
              <div className="mt-4">
                <RatingDistribution summary={summary} />
              </div>
            </div>
          ) : null}
          {user.accountType === 'BUSINESS' ? (
            <Link
              href={`/haendler/${user.id}`}
              className="mt-4 relative inline-flex items-center gap-1 text-sm font-semibold text-brand-700 tap hover:underline"
            >
              <Store className="size-4" aria-hidden="true" /> Händlerprofil und alle Anzeigen
            </Link>
          ) : null}
        </Card>
        <RatingsTransparencyNote className="px-1 text-xs leading-relaxed text-ink-500" />
      </aside>

      <section aria-labelledby="bewertungen-titel" className="min-w-0">
        <h2 id="bewertungen-titel" className="text-2xl font-bold text-ink-950">
          Bewertungen
        </h2>
        <div className="mt-4">
          <FlashMessage hinweis={hinweis} />
        </div>
        {items.length ? (
          <Card className="mt-4 divide-y divide-line p-5 sm:p-6">
            {items.map((item) => (
              <RatingEntry
                key={item.id}
                item={item}
                actions={
                  <Link
                    href={`/melden?bewertung=${item.id}`}
                    className="inline-flex items-center gap-1 text-ink-500 hover:text-danger-600 hover:underline"
                  >
                    <Flag className="size-3.5" aria-hidden="true" /> Melden
                  </Link>
                }
              />
            ))}
          </Card>
        ) : (
          <Card className="mt-4 flex flex-col items-center p-8 text-center">
            <Star className="size-8 text-line-strong" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink-900">Noch keine Bewertungen</p>
            <p className="mt-1 max-w-sm text-sm text-ink-500">
              Nach einem Kontakt über Markterl könnt ihr euch gegenseitig bewerten – direkt im Chat.
            </p>
          </Card>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          hrefFor={(p) =>
            p === 1 ? `/bewertungen/${user.id}` : `/bewertungen/${user.id}?seite=${p}`
          }
        />
      </section>
    </div>
  );
}
