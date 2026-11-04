'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { cn } from '@marktat/ui';
import { setDealPriceAlertAction } from '@/components/favorites/actions';

/** Preisalarm auf der Detailseite: E-Mail, sobald der Deal günstiger wird. Optimistisch wie „Merken“. */
export function PriceAlertButton({ id, initial, className }: { id: string; initial: boolean; className?: string }) {
  const [active, setActive] = useState(initial);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !active;
    setError(null);
    setActive(next);
    startTransition(async () => {
      const result = await setDealPriceAlertAction(id, next).catch(() => ({
        ok: false as const,
        reason: 'error' as const,
        message: 'Das hat nicht geklappt. Bitte versuche es erneut.',
      }));
      if (result.ok) {
        // „Merken“ zeigt danach ebenfalls „Gemerkt“
        router.refresh();
        return;
      }
      setActive(!next);
      if (result.reason === 'login') {
        const back = `${window.location.pathname}${window.location.search}`;
        router.push(`/anmelden?weiter=${encodeURIComponent(back)}&hinweis=merken`);
        return;
      }
      setError(result.message);
    });
  }

  const Icon = active ? BellRing : Bell;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={active}
        aria-busy={pending || undefined}
        data-price-alert={active ? 'ja' : 'nein'}
        className={cn(
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
          active ? 'border-brand-300 bg-brand-50 text-brand-800 hover:bg-brand-100' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400 hover:bg-canvas',
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
        <span>{active ? 'Preisalarm aktiv' : 'Preisalarm'}</span>
      </button>
      <p className="mt-1.5 text-xs text-ink-500">
        {active ? 'Wir schicken dir eine E-Mail, sobald der Preis sinkt.' : 'E-Mail, sobald dieser Deal günstiger wird.'}
      </p>
      <span role="status" className="sr-only">
        {error ?? ''}
      </span>
      {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
    </div>
  );
}
