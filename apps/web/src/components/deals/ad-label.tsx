import { cn } from '@marktat/ui';

/** Kennzeichnung bezahlter bzw. provisionierter Inhalte (Affiliate-Deals, Aktionen der Partnerprogramme) */
export function AdLabel({ className }: { className?: string }) {
  return (
    <span className={cn('shrink-0 rounded border border-ink-300 px-1.5 py-0.5 text-[0.625rem] leading-none font-semibold tracking-wide text-ink-600 uppercase', className)}>
      Werbung
    </span>
  );
}
