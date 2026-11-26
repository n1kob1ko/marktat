import { cn } from '@marktat/ui';
import { brandMarkSvg, WORDMARK } from './brand-mark';

/** Wort-Bild-Marke: Preisschild mit Bergspitze. Eigenständiges Design, keine Anlehnung an andere Marken. */
export function LogoMark({ className }: { className?: string }) {
  return brandMarkSvg(
    { shape: 'var(--color-primary)', cutout: 'var(--color-canvas)', accent: 'var(--color-accent-500)' },
    { className: cn('size-8', className) },
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className={cn('font-display text-[1.375rem] font-bold tracking-tight text-ink-950', wordmarkClassName)}>
        {WORDMARK.main}
        <span className="text-brand-700">{WORDMARK.accent}</span>
      </span>
    </span>
  );
}
