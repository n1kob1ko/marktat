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
      {/*
        Schriftzug als Logo-Grafik (SVG mit role="img"): Markennamen sind von den WCAG-Kontrastregeln ausgenommen,
        so bleibt das „erl“ im Marken-Orange. Maße für Bricolage Grotesque fett bei 100px (Breite 404, Ober-/Unterlänge 93/27).
      */}
      <span className={cn('font-display text-[1.375rem] font-bold tracking-tight text-ink-950', wordmarkClassName)}>
        <svg
          role="img"
          aria-label={`${WORDMARK.main}${WORDMARK.accent}`}
          viewBox="0 0 404 120"
          className="inline-block h-[1.2em] w-auto overflow-visible align-[-0.27em]"
        >
          <text x="0" y="93" fontSize="100" letterSpacing="-2.5" fill="currentColor">
            {WORDMARK.main}
            <tspan className="fill-accent-500">{WORDMARK.accent}</tspan>
          </text>
        </svg>
      </span>
    </span>
  );
}
