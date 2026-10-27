'use client';

import { useEffect } from 'react';

/** Meldet den Aufruf einer Anzeige einmal je Browser-Sitzung (Neuladen zählt nicht; die API dedupliziert zusätzlich). */
export function ViewBeacon({ listingId }: { listingId: string }) {
  useEffect(() => {
    const key = `marktat:aufruf:${listingId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Ohne sessionStorage (privater Modus) übernimmt die API das Entfernen von Wiederholungen
    }
    void fetch('/api/aufrufe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
      keepalive: true,
    }).catch(() => undefined);
  }, [listingId]);
  return null;
}
