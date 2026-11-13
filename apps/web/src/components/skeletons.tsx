import { cn, Skeleton } from '@marktat/ui';

/**
 * Platzhalter beim Laden in der Form des Inhalts (docs/design-bedienung.md): Karten, Zeilen und Formulare
 * stehen schon dort, wo gleich der Inhalt steht – die Seite springt beim Eintreffen nicht.
 */

const FRAME = 'rounded-[var(--radius-card)] border border-line bg-surface';

/** Karte einer Anzeige: Foto im Format 4:3, darunter Titel, Zusatz und Ort */
export function CardSkeleton() {
  return (
    <div aria-hidden="true" className={cn('flex w-full flex-col overflow-hidden', FRAME)}>
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-3.5 sm:p-4">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="mt-3 h-3 w-1/2" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Liste aus Zeilen-Karten: links zwei bis drei Textzeilen, rechts die Knöpfe */
export function RowsSkeleton({ rows = 4, actions = 2, className }: { rows?: number; actions?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5', FRAME)}>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-3/5 max-w-80" />
            <Skeleton className="h-4 w-2/5 max-w-56" />
            <Skeleton className="h-3 w-1/3 max-w-44" />
          </div>
          {actions ? (
            <div className="flex gap-2">
              {Array.from({ length: actions }, (_, j) => (
                <Skeleton key={j} className="h-9 w-24" />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Karte mit Überschrift und Eingabefeldern */
export function FormSkeleton({ fields = 3, className }: { fields?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-5 p-5 sm:p-7', FRAME, className)}>
      <Skeleton className="h-6 w-48 max-w-full" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
      <Skeleton className="h-11 w-40" />
    </div>
  );
}
