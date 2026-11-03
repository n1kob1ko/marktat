import type { ReactNode } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { formatDate, RATING_STAR_LABELS, type RatingItem } from '@marktat/shared';
import { Stars } from './rating-stars';

/** Rolle der bewertenden Person – nur bei Inseraten eindeutig (Kauf/Verkauf) */
export function raterRoleLabel(item: Pick<RatingItem, 'raterRole' | 'subject'>) {
  if (item.subject && item.subject.kind !== 'listing') return null;
  return item.raterRole === 'buyer' ? 'Käufer:in' : 'Verkäufer:in';
}

/** Eine Bewertung mit Antwort. `about` zeigt statt der bewertenden die bewertete Person (eigene, abgegebene Bewertungen). */
export function RatingEntry({
  item,
  about = false,
  actions,
  children,
}: {
  item: RatingItem;
  about?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const role = raterRoleLabel(item);
  return (
    <article
      className="space-y-2 py-5 first:pt-0 last:pb-0"
      aria-label={`Bewertung von ${item.rater.displayName}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={item.stars} />
        <span className="text-sm font-semibold text-ink-900">{RATING_STAR_LABELS[item.stars]}</span>
        {item.hidden ? (
          <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700">
            Vom Team ausgeblendet
          </span>
        ) : null}
      </div>
      <p className="text-sm text-ink-500">
        {about ? (
          <>
            Für <span className="font-medium text-ink-700">{item.ratee.displayName}</span>
          </>
        ) : (
          <>
            Von <span className="font-medium text-ink-700">{item.rater.displayName}</span>
            {role ? ` · ${role}` : ''}
          </>
        )}
        {' · '}
        {formatDate(item.createdAt)}
        {item.subject ? ` · zu „${item.subject.title}“` : ''}
      </p>
      {item.comment ? (
        <p className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-800">
          {item.comment}
        </p>
      ) : null}
      {item.reply ? (
        <div className="mt-2 flex gap-2.5 rounded-xl bg-canvas p-3 text-sm">
          <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">Antwort von {item.ratee.displayName}</p>
            <p className="mt-0.5 whitespace-pre-line text-ink-700">{item.reply}</p>
          </div>
        </div>
      ) : null}
      {children}
      {actions ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">{actions}</div>
      ) : null}
    </article>
  );
}

/** Transparenz zu Bewertungen (UWG in der Fassung der Omnibus-Richtlinie): wie sie entstehen und was wir prüfen */
export function RatingsTransparencyNote({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-xs leading-relaxed text-ink-500'}>
      So entstehen Bewertungen: Bewerten kann nur, wer mit der Person über Markterl zu einer Anzeige
      geschrieben hat, und erst, wenn beide geantwortet haben – je Unterhaltung einmal. Ob es
      tatsächlich zu einem Kauf kam, prüfen wir nicht. Gemeldete Bewertungen prüft ein Mensch aus
      unserem Team.
    </p>
  );
}
