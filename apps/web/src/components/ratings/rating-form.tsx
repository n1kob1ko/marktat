'use client';

import { useActionState, useState } from 'react';
import { Star } from 'lucide-react';
import { Alert, cn, Field, Textarea } from '@marktat/ui';
import { RATING_COMMENT_MAX, RATING_STAR_LABELS, RATING_REPLY_MAX } from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { SubmitButton } from '@/components/submit-button';
import { rateAction, replyAction } from '@/app/bewerten/actions';

/** Sterne wählen (1–5) und optional ein paar Worte dazu */
export function RatingForm({
  conversationId,
  partnerName,
  initial,
}: {
  conversationId: string;
  partnerName: string;
  initial?: { stars: number; comment: string | null };
}) {
  const [state, action] = useActionState(rateAction, initialFormState);
  const [stars, setStars] = useState(Number(state.values?.stars) || initial?.stars || 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(state.values?.comment ?? initial?.comment ?? '');
  const shown = hover || stars;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-5">
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
      <input type="hidden" name="conversationId" value={conversationId} />
      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">
          Wie war es mit {partnerName}?
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <label
                key={value}
                className="relative cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500"
                onMouseEnter={() => setHover(value)}
              >
                <input
                  type="radio"
                  name="stars"
                  value={value}
                  checked={stars === value}
                  onChange={() => setStars(value)}
                  className="sr-only"
                  required
                />
                <span className="sr-only">
                  {value} {value === 1 ? 'Stern' : 'Sterne'} – {RATING_STAR_LABELS[value]}
                </span>
                <Star
                  className={cn(
                    'size-9 press',
                    value <= shown
                      ? 'fill-accent-500 text-accent-500'
                      : 'fill-transparent text-line-strong',
                  )}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </label>
            ))}
          </div>
          <span className="text-sm font-semibold text-ink-700" aria-hidden="true">
            {shown ? RATING_STAR_LABELS[shown] : ''}
          </span>
        </div>
        {errors.stars ? (
          <p className="mt-1 text-sm font-medium text-danger-600">{errors.stars[0]}</p>
        ) : null}
      </fieldset>
      <Field
        label="Ein paar Worte dazu"
        hint={`Optional, öffentlich sichtbar. Sachlich bleiben – keine Beleidigungen, keine Telefonnummern. ${comment.length}/${RATING_COMMENT_MAX}`}
        error={errors.comment}
      >
        <Textarea
          name="comment"
          rows={4}
          maxLength={RATING_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="z. B. Freundlich, pünktlich, alles wie beschrieben."
        />
      </Field>
      <SubmitButton>{initial ? 'Bewertung ändern' : 'Bewertung abschicken'}</SubmitButton>
    </form>
  );
}

/** Öffentliche Antwort auf eine Bewertung über mich */
export function ReplyForm({ ratingId, initial }: { ratingId: string; initial: string | null }) {
  const [state, action] = useActionState(replyAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
      <input type="hidden" name="ratingId" value={ratingId} />
      <Field
        label="Deine Antwort"
        hint={`Höchstens ${RATING_REPLY_MAX} Zeichen. Sie erscheint unter der Bewertung.`}
        error={errors.body}
        required
      >
        <Textarea
          name="body"
          rows={3}
          maxLength={RATING_REPLY_MAX}
          defaultValue={state.values?.body ?? initial ?? ''}
          className="min-h-20"
        />
      </Field>
      <SubmitButton size="sm" variant="outline">
        Antwort speichern
      </SubmitButton>
    </form>
  );
}
