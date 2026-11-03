import type { RatingSummary } from '@marktat/shared';
import { api } from '@/lib/api';

/** Bewertungen einer Person für Verkäufer-Karten; bei einem Fehler lieber nichts zeigen als die Seite zu stören */
export async function loadRatingSummary(userId: string): Promise<RatingSummary | null> {
  try {
    return await api<RatingSummary>(`/users/${userId}/rating-summary`, { cache: 'no-store' });
  } catch {
    return null;
  }
}
