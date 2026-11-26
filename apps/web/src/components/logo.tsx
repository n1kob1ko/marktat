import { cn } from '@marktat/ui';
import { brandMarkSvg, WORDMARK } from './brand-mark';

/** Wort-Bild-Marke: Preisschild mit „m“. Eigenständiges Design, keine Anlehnung an andere Marken. */
export function LogoMark({ className }: { className?: string }) {
  return brandMarkSvg(
    { shape: 'var(--color-primary)', hole: 'var(--color-accent-500)', letter: '#ffffff' },
    { className: cn('size-8', className) },
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className={cn('font-display text-[1.375rem] font-bold tracking-tight text-ink-950', wordmarkClassName)}>
        {WORDMARK.main}
        <span className="text-accent-500">{WORDMARK.accent}</span>
      </span>
    </span>
  );
}
