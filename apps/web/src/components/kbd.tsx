'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@marktat/ui';

const noop = () => () => {};

function modKey(): string {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Strg';
}

/**
 * Beschriftung der Befehlstaste: „⌘“ am Mac, sonst „Strg“. Auf dem Server (und bis zum Hydrieren) `null`,
 * damit Server- und Browser-HTML übereinstimmen – Kürzel-Hinweise erscheinen erst im Browser.
 */
export function useModKey(): string | null {
  return useSyncExternalStore(noop, modKey, () => null);
}

/** Hinweis auf ein Tastenkürzel neben einem Knopf oder Feld. Nur sinnvoll, wo es eine Tastatur gibt. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 items-center rounded-md border border-line-strong bg-surface px-1.5 font-sans text-[0.6875rem] leading-none font-semibold whitespace-nowrap text-ink-500',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
