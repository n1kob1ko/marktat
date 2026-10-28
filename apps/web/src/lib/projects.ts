import {
  PROJECT_EXPIRED_LABEL,
  SERVICE_PROJECT_STATUS_LABELS,
  formatPriceCents,
  projectSearchHref,
  serviceCategoryBySlug,
  serviceGroupBySlug,
  type LocationSummary,
  type ProjectSearchQuery,
  type ServiceProjectStatus,
  type ServiceProjectSummary,
} from '@marktat/shared';
import type { ServiceChip } from '@/lib/services';

/** „Budget € 800 pauschal“, „bis € 35 / Stunde“ oder „Budget nach Absprache“ */
export function projectBudgetLabel(project: Pick<ServiceProjectSummary, 'budgetType' | 'budgetCents'>): string {
  if (project.budgetType === 'OPEN' || project.budgetCents === null) return 'Budget nach Absprache';
  const amount = formatPriceCents(project.budgetCents);
  return project.budgetType === 'HOURLY' ? `bis ${amount} / Stunde` : `Budget ${amount} pauschal`;
}

/** „8010 Graz · remote möglich“ bzw. „Remote“ */
export function projectPlaceLabel(project: Pick<ServiceProjectSummary, 'location' | 'remote'>): string {
  const parts: string[] = [];
  if (project.location) parts.push(`${project.location.postalCode} ${project.location.place}`);
  if (project.remote) parts.push(parts.length ? 'remote möglich' : 'Remote');
  return parts.join(' · ');
}

/** Sichtbarer oder pausierter Auftrag, dessen Laufzeit vorbei ist */
export function projectExpired(project: { status: ServiceProjectStatus; expiresAt: string | null }, now = Date.now()): boolean {
  return (project.status === 'ACTIVE' || project.status === 'PAUSED') && project.expiresAt !== null && new Date(project.expiresAt).getTime() <= now;
}

/** Status im Konto; sichtbare Aufträge nach Ende der Laufzeit heißen „abgelaufen“ */
export function projectStatusLabel(status: ServiceProjectStatus, expired: boolean): string {
  return expired ? PROJECT_EXPIRED_LABEL : SERVICE_PROJECT_STATUS_LABELS[status];
}

/** Aktive Filter der Auftragssuche als entfernbare Chips */
export function projectChips(query: ProjectSearchQuery, location: LocationSummary | null): ServiceChip[] {
  const chips: ServiceChip[] = [];
  const without = (change: Partial<ProjectSearchQuery>) => projectSearchHref({ ...query, ...change, page: 1 });
  if (query.category) {
    chips.push({ id: 'kategorie', label: serviceCategoryBySlug(query.category)?.name ?? query.category, removeHref: without({ category: undefined, group: undefined }) });
  } else if (query.group) {
    chips.push({ id: 'bereich', label: serviceGroupBySlug(query.group)?.name ?? query.group, removeHref: without({ group: undefined }) });
  }
  if (query.locationId || query.postalCode) {
    const where = location ? `${location.postalCode} ${location.place}` : (query.postalCode ?? 'Ort');
    chips.push({
      id: 'ort',
      label: query.radiusKm ? `${where} + ${query.radiusKm} km` : where,
      removeHref: without({ locationId: undefined, postalCode: undefined, radiusKm: undefined, sort: 'neueste' }),
    });
  }
  if (query.remote) chips.push({ id: 'remote', label: 'Remote möglich', removeHref: without({ remote: undefined }) });
  return chips;
}
