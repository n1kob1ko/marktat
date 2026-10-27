import { cn } from '@marktat/ui';

/** Wort-Bild-Marke: Preisschild mit Bergspitze. Eigenständiges Design, keine Anlehnung an andere Marken. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <path
        d="M4 9.5A5.5 5.5 0 0 1 9.5 4h9.38a5.5 5.5 0 0 1 3.89 1.61l5.62 5.62a5.5 5.5 0 0 1 0 7.78l-9.38 9.38a5.5 5.5 0 0 1-7.78 0l-5.62-5.62A5.5 5.5 0 0 1 4 18.88Z"
        fill="var(--color-brand-700)"
      />
      <circle cx="11" cy="11" r="2.4" fill="var(--color-canvas)" />
      <path d="m10.5 22.5 5-7.5 2.6 3.6 1.9-2.4 3.5 5.3Z" fill="var(--color-accent-500)" />
    </svg>
  );
}

export function Logo({ className, wordmarkClassName }: { className?: string; wordmarkClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className={cn('font-display text-[1.375rem] font-bold tracking-tight text-ink-950', wordmarkClassName)}>
        Markt<span className="text-brand-700">AT</span>
      </span>
    </span>
  );
}
