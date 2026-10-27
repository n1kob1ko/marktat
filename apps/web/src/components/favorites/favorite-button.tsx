'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@marktat/ui';
import { setFavoriteAction } from './actions';
import { setFavoriteState, useFavoriteState } from './favorite-store';

interface FavoriteButtonProps {
  listingId: string;
  title: string;
  /** Vom Server bekannter Status; ohne wird er für alle Karten gesammelt nachgeladen */
  initial?: boolean;
  /** Rücksprung nach der Anmeldung; Standard: die aktuelle Seite */
  returnTo?: string;
  variant?: 'card' | 'detail';
  className?: string;
}

/** Herz zum Merken. Optimistisch: der Zustand wechselt sofort und springt bei einem Fehler zurück. */
export function FavoriteButton({ listingId, title, initial, returnTo, variant = 'card', className }: FavoriteButtonProps) {
  const state = useFavoriteState(listingId, initial);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state === 'own') return null;
  const active = state === 'yes';
  const label = active ? `„${title}“ von der Merkliste entfernen` : `„${title}“ merken`;

  function toggle() {
    const next = !active;
    setError(null);
    setFavoriteState(listingId, next ? 'yes' : 'no');
    startTransition(async () => {
      const result = await setFavoriteAction(listingId, next).catch(() => ({
        ok: false as const,
        reason: 'error' as const,
        message: 'Das hat nicht geklappt. Bitte versuche es erneut.',
      }));
      if (result.ok) return;
      setFavoriteState(listingId, active ? 'yes' : 'no');
      if (result.reason === 'login') {
        const back = returnTo ?? `${window.location.pathname}${window.location.search}`;
        router.push(`/anmelden?weiter=${encodeURIComponent(back)}&hinweis=merken`);
        return;
      }
      setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        aria-label={variant === 'card' ? label : undefined}
        title={error ?? label}
        aria-busy={pending || undefined}
        data-favorite={active ? 'ja' : 'nein'}
        className={cn(
          'relative z-10 inline-flex items-center justify-center gap-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
          variant === 'card'
            ? 'size-10 rounded-full bg-surface/95 shadow-sm ring-1 ring-ink-900/10 backdrop-blur hover:bg-surface'
            : 'h-11 rounded-xl border border-line-strong bg-surface px-4 text-[0.9375rem] hover:border-ink-400 hover:bg-canvas',
          active ? 'text-danger-600' : 'text-ink-700 hover:text-danger-600',
          className,
        )}
      >
        <Heart className={cn('size-5', active && 'fill-current')} aria-hidden="true" />
        {variant === 'detail' ? <span>{active ? 'Gemerkt' : 'Merken'}</span> : null}
      </button>
      <span role="status" className="sr-only">
        {error ?? ''}
      </span>
      {error && variant === 'detail' ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
    </>
  );
}
