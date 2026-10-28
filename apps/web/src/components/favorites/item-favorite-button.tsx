'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@marktat/ui';
import { setItemFavoriteAction, type FavoriteKind } from './actions';

interface ItemFavoriteButtonProps {
  kind: FavoriteKind;
  id: string;
  title: string;
  initial: boolean;
  className?: string;
}

/** „Merken“ auf der Detailseite eines Deals oder Anbieterprofils. Optimistisch wie das Herz bei Anzeigen. */
export function ItemFavoriteButton({ kind, id, title, initial, className }: ItemFavoriteButtonProps) {
  const [active, setActive] = useState(initial);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = active ? `„${title}“ von der Merkliste entfernen` : `„${title}“ merken`;

  function toggle() {
    const next = !active;
    setError(null);
    setActive(next);
    startTransition(async () => {
      const result = await setItemFavoriteAction(kind, id, next).catch(() => ({
        ok: false as const,
        reason: 'error' as const,
        message: 'Das hat nicht geklappt. Bitte versuche es erneut.',
      }));
      if (result.ok) return;
      setActive(!next);
      if (result.reason === 'login') {
        const back = `${window.location.pathname}${window.location.search}`;
        router.push(`/anmelden?weiter=${encodeURIComponent(back)}&hinweis=merken`);
        return;
      }
      setError(result.message);
    });
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        title={error ?? label}
        aria-busy={pending || undefined}
        data-favorite={active ? 'ja' : 'nein'}
        className={cn(
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-[0.9375rem] font-semibold transition-colors hover:border-ink-400 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
          active ? 'text-danger-600' : 'text-ink-700 hover:text-danger-600',
        )}
      >
        <Heart className={cn('size-5', active && 'fill-current')} aria-hidden="true" />
        <span>{active ? 'Gemerkt' : 'Merken'}</span>
      </button>
      <span role="status" className="sr-only">
        {error ?? ''}
      </span>
      {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
    </div>
  );
}
