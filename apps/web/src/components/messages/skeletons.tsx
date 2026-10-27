import { Skeleton } from '@marktat/ui';

export function ListSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-label="Wird geladen">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-10" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-14 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-label="Wird geladen">
      <div className="flex items-center gap-3 border-b border-line p-3">
        <Skeleton className="size-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="flex-1 space-y-3 p-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-16 w-3/5" />
      </div>
      <div className="border-t border-line p-3">
        <Skeleton className="h-11" />
      </div>
    </div>
  );
}
