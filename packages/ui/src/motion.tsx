import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Zwei Zustände an derselben Stelle (Symbol oder Beschriftung), die beim Wechsel überblenden statt umzuspringen.
 * Beide liegen übereinander; der gerade nicht gezeigte ist für Vorlesesoftware und Tests unsichtbar.
 * Stil und Dauer: motion.css (.swap).
 */
export function Swap({
  active,
  on,
  off,
  kind = 'icon',
  className,
}: {
  /** true zeigt `on`, false zeigt `off` */
  active: boolean;
  on: ReactNode;
  off: ReactNode;
  kind?: 'icon' | 'text';
  className?: string;
}) {
  return (
    <span className={cn('swap', className)} data-kind={kind}>
      <span data-swap={active ? 'on' : 'off'} aria-hidden={active ? undefined : true}>
        {on}
      </span>
      <span data-swap={active ? 'off' : 'on'} aria-hidden={active ? true : undefined}>
        {off}
      </span>
    </span>
  );
}
