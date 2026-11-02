'use client';

import { useSyncExternalStore } from 'react';
import { Badge } from '@marktat/ui';

const DAY_MS = 86_400_000;
const subscribe = () => () => {};

/** „Neu“ für Inserate der letzten 24 Stunden. Erst im Browser berechnet, damit zwischengespeicherte Seiten nicht veralten. */
export function NewBadge({ publishedAt }: { publishedAt: string }) {
  const isNew = useSyncExternalStore(
    subscribe,
    () => Date.now() - Date.parse(publishedAt) < DAY_MS,
    () => false,
  );
  if (!isNew) return null;
  return (
    <Badge tone="brand" className="bg-primary text-white shadow-sm" title="In den letzten 24 Stunden eingestellt">
      Neu
    </Badge>
  );
}
