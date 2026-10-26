'use client';

import { useSyncExternalStore } from 'react';
import { formatDate } from '@marktat/shared';

const rtf = new Intl.RelativeTimeFormat('de-AT', { numeric: 'auto' });

function relative(value: string, now: number) {
  const diffMinutes = Math.round((Date.parse(value) - now) / 60_000);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return rtf.format(diffDays, 'day');
  return formatDate(value);
}

const subscribe = () => () => {};

/** Relatives Datum („vor 3 Stunden“). Auf dem Server wird das absolute Datum gerendert. */
export function RelativeDate({ value }: { value: string }) {
  const label = useSyncExternalStore(
    subscribe,
    () => relative(value, Date.now()),
    () => formatDate(value),
  );
  return <time dateTime={value}>{label}</time>;
}
