import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Alert, Card, Container, Skeleton } from '@marktat/ui';
import type { ConversationRating } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ENTITY_ID } from '@/lib/admin';
import { FlashMessage } from '@/components/flash-message';
import { ConfirmDeleteButton } from '@/components/confirm-delete-button';
import { RatingForm } from '@/components/ratings/rating-form';
import { RatingEntry, RatingsTransparencyNote } from '@/components/ratings/rating-list';
import { deleteRatingAction } from '../actions';

export const metadata: Metadata = { title: 'Bewerten', robots: { index: false } };

export default function RatePage({ params, searchParams }: PageProps<'/bewerten/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto my-10 h-96 max-w-2xl" />}>
      <RateContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RateContent({
  params,
  searchParams,
}: Pick<PageProps<'/bewerten/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { token } = await requireUser(`/bewerten/${id}`);
  let rating: ConversationRating;
  try {
    rating = await api<ConversationRating>(`/conversations/${id}/rating`, {
      token,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { partner, subject, mine, theirs, blockedReason } = rating;
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;

  return (
    <Container className="max-w-2xl py-8 sm:py-12">
      <Link
        href={`/nachrichten/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Zurück zur Unterhaltung
      </Link>
      <h1 className="mt-4 text-3xl font-bold text-ink-950 sm:text-4xl">
        {partner.displayName} bewerten
      </h1>
      <p className="mt-2 text-ink-600">
        Zu{' '}
        <Link href={subject.href} className="font-semibold text-brand-700 hover:underline">
          {subject.title}
        </Link>
      </p>
      <div className="mt-5">
        <FlashMessage hinweis={hinweis} />
      </div>

      <Card className="mt-6 space-y-5 p-5 sm:p-7">
        {mine?.hidden ? (
          <Alert tone="warning">
            Deine Bewertung hat unser Team ausgeblendet. Die Begründung findest du unter{' '}
            <Link href="/konto/mitteilungen" className="font-semibold underline">
              Mitteilungen
            </Link>
            . Du kannst dort Einspruch erheben oder die Bewertung löschen.
          </Alert>
        ) : blockedReason && !mine ? (
          <Alert tone="info">{blockedReason}</Alert>
        ) : blockedReason && mine ? (
          <>
            <Alert tone="info">{blockedReason} Deine Bewertung bleibt sichtbar.</Alert>
            <RatingEntry item={mine} about />
          </>
        ) : (
          <RatingForm
            conversationId={id}
            partnerName={partner.displayName}
            initial={mine ? { stars: mine.stars, comment: mine.comment } : undefined}
          />
        )}
        {mine ? (
          <form action={deleteRatingAction} className="border-t border-line pt-4">
            <input type="hidden" name="conversationId" value={id} />
            <p className="mb-2 text-sm text-ink-600">
              Du kannst deine Bewertung jederzeit löschen.
            </p>
            <ConfirmDeleteButton />
          </form>
        ) : null}
        <RatingsTransparencyNote />
      </Card>

      {theirs ? (
        <section className="mt-8" aria-labelledby="ueber-dich">
          <h2 id="ueber-dich" className="text-xl font-bold text-ink-950">
            So hat {partner.displayName} dich bewertet
          </h2>
          <Card className="mt-3 p-5 sm:p-6">
            <RatingEntry item={theirs} />
            <p className="mt-3 text-sm">
              <Link
                href="/konto/bewertungen"
                className="font-semibold text-brand-700 hover:underline"
              >
                Antworten oder melden
              </Link>
            </p>
          </Card>
        </section>
      ) : null}
    </Container>
  );
}
