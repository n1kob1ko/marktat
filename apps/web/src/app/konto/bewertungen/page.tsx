import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Flag, Pencil, Star } from 'lucide-react';
import { Card, Skeleton } from '@marktat/ui';
import type { MyRatings } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { SubmitButton } from '@/components/submit-button';
import { RatingSummaryLink } from '@/components/ratings/rating-stars';
import { RatingEntry, RatingsTransparencyNote } from '@/components/ratings/rating-list';
import { ReplyForm } from '@/components/ratings/rating-form';
import { deleteReplyAction } from '@/app/bewerten/actions';

export const metadata: Metadata = { title: 'Bewertungen', robots: { index: false } };

export default function MyRatingsPage({ searchParams }: PageProps<'/konto/bewertungen'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Ratings searchParams={searchParams} />
    </Suspense>
  );
}

async function Ratings({ searchParams }: Pick<PageProps<'/konto/bewertungen'>, 'searchParams'>) {
  const [{ user, token }, query] = await Promise.all([
    requireUser('/konto/bewertungen'),
    searchParams,
  ]);
  const { summary, received, given } = await api<MyRatings>('/me/ratings', {
    token,
    cache: 'no-store',
  });
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;

  return (
    <div className="max-w-3xl space-y-8">
      <FlashMessage hinweis={hinweis} />
      <section aria-labelledby="erhalten" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="erhalten" className="text-xl font-bold text-ink-950">
            Über dich
          </h2>
          <RatingSummaryLink summary={summary} href={`/bewertungen/${user.id}`} />
        </div>
        {received.length ? (
          <Card className="divide-y divide-line p-5 sm:p-6">
            {received.map((item) => (
              <RatingEntry
                key={item.id}
                item={item}
                actions={
                  <>
                    {item.reply ? (
                      <form action={deleteReplyAction}>
                        <input type="hidden" name="ratingId" value={item.id} />
                        <SubmitButton variant="ghost" size="sm" className="-ml-3">
                          Antwort entfernen
                        </SubmitButton>
                      </form>
                    ) : null}
                    <Link
                      href={`/melden?bewertung=${item.id}`}
                      className="inline-flex items-center gap-1 self-center text-ink-500 hover:text-danger-600 hover:underline"
                    >
                      <Flag className="size-3.5" aria-hidden="true" /> Melden
                    </Link>
                  </>
                }
              >
                <details className="group rounded-xl border border-line px-3.5 py-2.5 open:pb-3.5">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-700">
                    {item.reply ? 'Antwort ändern' : 'Öffentlich antworten'}
                  </summary>
                  <div className="mt-3">
                    <ReplyForm ratingId={item.id} initial={item.reply} />
                  </div>
                </details>
              </RatingEntry>
            ))}
          </Card>
        ) : (
          <Card className="px-6 py-10 text-center">
            <Star className="mx-auto size-8 text-line-strong" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink-900">Noch keine Bewertungen über dich</p>
            <p className="mt-1 text-sm text-ink-500">
              Nach einem Kontakt über Markterl könnt ihr euch gegenseitig bewerten – im Chat über
              „Bewerten“.
            </p>
          </Card>
        )}
      </section>

      <section aria-labelledby="abgegeben" className="space-y-3">
        <h2 id="abgegeben" className="text-xl font-bold text-ink-950">
          Von dir abgegeben
        </h2>
        {given.length ? (
          <Card className="divide-y divide-line p-5 sm:p-6">
            {given.map((item) => (
              <RatingEntry
                key={item.id}
                item={item}
                about
                actions={
                  item.conversationId ? (
                    <Link
                      href={`/bewerten/${item.conversationId}`}
                      className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />{' '}
                      {item.hidden ? 'Ansehen oder löschen' : 'Ändern oder löschen'}
                    </Link>
                  ) : null
                }
              />
            ))}
          </Card>
        ) : (
          <p className="text-sm text-ink-500">
            Du hast noch niemanden bewertet. Das geht in einer Unterhaltung über „Bewerten“, sobald
            ihr beide geschrieben habt.
          </p>
        )}
      </section>
      <RatingsTransparencyNote />
    </div>
  );
}
