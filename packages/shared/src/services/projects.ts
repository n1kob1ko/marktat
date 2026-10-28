/**
 * Projektaufträge (Phase 10, Schritt 4): Jemand sucht für ein konkretes Vorhaben eine selbstständige Dienstleistung.
 * Bewusst kein Jobangebot (kein Arbeitsverhältnis) und keine Ausschreibung: keine Gebote, keine öffentlichen
 * Angebote, keine Vergabe über MarktAT. Anbieter:innen mit sichtbarem Profil melden sich über die Nachrichten.
 *
 * URL und API verwenden dieselben Parameter, z. B.
 *   /dienstleistungen/projekte?bereich=haus-handwerk&plz=8010&umkreis=25
 */
import { z } from '../schemas/zod.js';
import { isAustrianPostalCode } from '../austria.js';
import { MAX_SEARCH_PAGE, SEARCH_RADII, type RawSearchParams, type SearchParamIssue, type SearchRadius } from '../search/params.js';
import type { UserStatus } from '../schemas/moderation.js';
import type { AdminDecision, AdminReportSummary, ListingModerationInfo, LocationSummary, Paginated, PersonRef } from '../types.js';
import { serviceCategoryBySlug, serviceGroupBySlug } from './categories.js';
import { SERVICE_MAX_PRICE_CENTS } from './enums.js';
import type { ServiceCategoryView } from './types.js';

export const SERVICE_PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'PENDING_REVIEW', 'REJECTED', 'DELETED'] as const;
export type ServiceProjectStatus = (typeof SERVICE_PROJECT_STATUSES)[number];
export const SERVICE_PROJECT_STATUS_LABELS: Record<ServiceProjectStatus, string> = {
  DRAFT: 'Entwurf',
  ACTIVE: 'Sichtbar',
  PAUSED: 'Pausiert',
  CLOSED: 'Beendet',
  PENDING_REVIEW: 'In Prüfung',
  REJECTED: 'Abgelehnt',
  DELETED: 'Gelöscht',
};
/** Anzeige im Konto: ein sichtbarer Auftrag, dessen Laufzeit vorbei ist, heißt „abgelaufen“ */
export const PROJECT_EXPIRED_LABEL = 'Abgelaufen';

export const PROJECT_BUDGET_TYPES = ['FIXED', 'HOURLY', 'OPEN'] as const;
export type ProjectBudgetType = (typeof PROJECT_BUDGET_TYPES)[number];
export const PROJECT_BUDGET_TYPE_LABELS: Record<ProjectBudgetType, string> = {
  FIXED: 'Pauschalbudget',
  HOURLY: 'Stundensatz bis',
  OPEN: 'Budget offen, nach Absprache',
};

/** Sichtbarkeit ab Veröffentlichung bzw. Verlängerung */
export const PROJECT_RUN_DAYS = 30;
/** Verlängern frühestens so viele Tage vor dem Ende */
export const PROJECT_EXTEND_WINDOW_DAYS = 7;
/** Gleichzeitig sichtbare, pausierte oder geprüfte Aufträge je Konto */
export const PROJECT_MAX_OPEN = 5;
/** Höchstens so viele Anbieter:innen können einen Auftrag anschreiben – danach keine neuen Anfragen (Schutz vor Flut) */
export const PROJECT_MAX_CONTACTS = 20;

export const serviceProjectSchema = z
  .object({
    title: z.string({ error: 'Bitte gib einen Titel ein.' }).trim().min(5, 'Mindestens 5 Zeichen.').max(120, 'Höchstens 120 Zeichen.'),
    description: z
      .string({ error: 'Bitte beschreibe das Vorhaben.' })
      .trim()
      .min(50, 'Mindestens 50 Zeichen – je genauer, desto passender die Anfragen.')
      .max(5000, 'Höchstens 5000 Zeichen.'),
    categorySlug: z.string({ error: 'Bitte wähle eine Kategorie.' }).refine((slug) => Boolean(serviceCategoryBySlug(slug)), 'Bitte wähle eine Kategorie.'),
    locationId: z.number().int().positive().nullable().optional(),
    remote: z.boolean().default(false),
    budgetType: z.enum(PROJECT_BUDGET_TYPES, { error: 'Bitte wähle die Art des Budgets.' }),
    budgetCents: z.number().int().positive('Der Betrag muss größer als 0 sein.').max(SERVICE_MAX_PRICE_CENTS, 'Der Betrag ist zu hoch.').nullable().optional(),
    timeframe: z
      .string()
      .trim()
      .max(160, 'Höchstens 160 Zeichen.')
      .transform((v) => v || null)
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.budgetType !== 'OPEN' && !value.budgetCents) {
      ctx.addIssue({ code: 'custom', path: ['budgetCents'], message: 'Bitte gib den Betrag an oder wähle „Budget offen“.' });
    }
    if (!value.locationId && !value.remote) {
      ctx.addIssue({ code: 'custom', path: ['locationId'], message: 'Bitte gib den Ort an oder wähle „remote möglich“.' });
    }
  })
  .transform((value) => ({ ...value, budgetCents: value.budgetType === 'OPEN' ? null : (value.budgetCents ?? null), timeframe: value.timeframe ?? null }));
export type ServiceProjectInput = z.input<typeof serviceProjectSchema>;
export type ServiceProjectFields = z.output<typeof serviceProjectSchema>;

export const projectPublishSchema = z.object({
  /** Bestätigung: selbstständige Leistung für ein konkretes Vorhaben, kein Arbeitsverhältnis, eigene Angaben */
  confirmed: z.literal(true, { error: 'Bitte bestätige deine Angaben.' }),
});

export interface ProjectClientRef {
  id: string;
  name: string;
  business: boolean;
  memberSince: string;
}

export interface ServiceProjectSummary {
  id: string;
  title: string;
  /** Anfang der Beschreibung (für Karten) */
  excerpt: string;
  category: ServiceCategoryView;
  location: LocationSummary | null;
  remote: boolean;
  budgetType: ProjectBudgetType;
  budgetCents: number | null;
  timeframe: string | null;
  client: ProjectClientRef;
  publishedAt: string | null;
  expiresAt: string | null;
  /** false = keine neuen Anfragen mehr möglich (Höchstzahl erreicht) */
  acceptsContacts: boolean;
  distanceKm: number | null;
}

export interface ServiceProjectDetail extends ServiceProjectSummary {
  status: ServiceProjectStatus;
  description: string;
  closedAt: string | null;
  /** Öffentlich sichtbar (aktiv, nicht abgelaufen, Konto aktiv) */
  isPublic: boolean;
  isOwner: boolean;
  /** Bestehende Unterhaltung der angemeldeten Person */
  conversationId: string | null;
  /** Ob die angemeldete Person anschreiben kann; sonst der Grund (nur für angemeldete Personen) */
  contact: { allowed: boolean; reason: string | null } | null;
  moderation: ListingModerationInfo | null;
}

export interface MyServiceProject extends ServiceProjectDetail {
  /** Zahl der Anbieter:innen, die geschrieben haben */
  contactCount: number;
  viewCount: number;
  reviewReason: string | null;
  expired: boolean;
}

export interface MyServiceProjects {
  projects: MyServiceProject[];
  openCount: number;
  maxOpen: number;
}

export interface ProjectSearchResult extends Paginated<ServiceProjectSummary> {
  totalPages: number;
  location: LocationSummary | null;
}

// --- Suchparameter -------------------------------------------------------------------

export const PROJECT_SORTS = ['neueste', 'entfernung'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = { neueste: 'Neueste zuerst', entfernung: 'Entfernung' };

export const PROJECT_PAGE_SIZE = 20;

export interface ProjectSearchQuery {
  q?: string;
  group?: string;
  category?: string;
  postalCode?: string;
  locationId?: number;
  radiusKm?: SearchRadius;
  /** Nur Aufträge, die remote erledigt werden können (dann schränkt der Ort nicht ein) */
  remote?: boolean;
  sort: ProjectSort;
  page: number;
  pageSize: number;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const yes = (value: string | undefined) => value === 'ja' || value === '1' || value === 'true';

export function parseProjectSearchParams(input: RawSearchParams): { query: ProjectSearchQuery; issues: SearchParamIssue[] } {
  const issues: SearchParamIssue[] = [];
  const query: ProjectSearchQuery = { sort: 'neueste', page: 1, pageSize: PROJECT_PAGE_SIZE };
  const q = first(input.q);
  if (q) {
    if (q.length > 100) issues.push({ param: 'q', message: 'Der Suchbegriff darf höchstens 100 Zeichen lang sein.' });
    else query.q = q.replace(/\s+/g, ' ');
  }
  const group = first(input.bereich);
  if (group) {
    if (serviceGroupBySlug(group)) query.group = group;
    else issues.push({ param: 'bereich', message: 'Unbekannter Bereich.' });
  }
  const category = first(input.kategorie);
  if (category) {
    const found = serviceCategoryBySlug(category);
    if (found) {
      query.category = category;
      query.group = found.group.slug;
    } else issues.push({ param: 'kategorie', message: 'Unbekannte Kategorie.' });
  }
  const postalCode = first(input.plz);
  if (postalCode) {
    if (isAustrianPostalCode(postalCode)) query.postalCode = postalCode;
    else issues.push({ param: 'plz', message: 'Bitte gib eine gültige österreichische Postleitzahl ein.' });
  }
  const locationId = first(input.ort);
  if (locationId) {
    if (/^\d{1,9}$/.test(locationId) && Number(locationId) > 0) query.locationId = Number(locationId);
    else issues.push({ param: 'ort', message: 'Unbekannter Ort.' });
  }
  const radius = first(input.umkreis);
  if (radius) {
    const km = Number(radius);
    if ((SEARCH_RADII as readonly number[]).includes(km)) query.radiusKm = km as SearchRadius;
    else issues.push({ param: 'umkreis', message: `Umkreis muss einer dieser Werte sein: ${SEARCH_RADII.join(', ')} km.` });
  }
  if (query.radiusKm && !query.locationId && !query.postalCode) {
    issues.push({ param: 'umkreis', message: 'Für die Umkreissuche bitte einen Ort oder eine PLZ angeben.' });
    delete query.radiusKm;
  }
  if (yes(first(input.remote))) query.remote = true;
  const sort = first(input.sortierung);
  if (sort) {
    if (!(PROJECT_SORTS as readonly string[]).includes(sort)) issues.push({ param: 'sortierung', message: 'Unbekannte Sortierung.' });
    else if (sort === 'entfernung' && !query.locationId && !query.postalCode) query.sort = 'neueste';
    else query.sort = sort as ProjectSort;
  }
  const page = first(input.seite);
  if (page) {
    const n = Number(page);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_SEARCH_PAGE) query.page = n;
    else issues.push({ param: 'seite', message: `Seite muss zwischen 1 und ${MAX_SEARCH_PAGE} liegen.` });
  }
  const pageSize = first(input.pageSize);
  if (pageSize) {
    const n = Number(pageSize);
    if (Number.isInteger(n) && n >= 1 && n <= 50) query.pageSize = n;
    else issues.push({ param: 'pageSize', message: 'pageSize muss zwischen 1 und 50 liegen.' });
  }
  return { query, issues };
}

export function toProjectSearchParams(query: ProjectSearchQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.q) params.q = query.q;
  if (query.category) params.kategorie = query.category;
  else if (query.group) params.bereich = query.group;
  if (query.locationId) params.ort = String(query.locationId);
  else if (query.postalCode) params.plz = query.postalCode;
  if (query.radiusKm && (query.locationId || query.postalCode)) params.umkreis = String(query.radiusKm);
  if (query.remote) params.remote = 'ja';
  if (query.sort !== 'neueste') params.sortierung = query.sort;
  if (query.page > 1) params.seite = String(query.page);
  if (query.pageSize !== PROJECT_PAGE_SIZE) params.pageSize = String(query.pageSize);
  return params;
}

export function projectSearchHref(query: ProjectSearchQuery, base = '/dienstleistungen/projekte'): string {
  const params = new URLSearchParams(toProjectSearchParams(query));
  params.delete('pageSize');
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

export function hasActiveProjectFilters(query: ProjectSearchQuery): boolean {
  return Boolean(query.q || query.group || query.category || query.postalCode || query.locationId || query.remote);
}

// --- Admin -------------------------------------------------------------------------

export const ADMIN_PROJECT_FILTERS = ['review', 'reported', 'ACTIVE', 'PAUSED', 'CLOSED', 'PENDING_REVIEW', 'REJECTED', 'DRAFT', 'all'] as const;
export type AdminProjectFilter = (typeof ADMIN_PROJECT_FILTERS)[number];
export const ADMIN_PROJECT_FILTER_LABELS: Record<AdminProjectFilter, string> = {
  review: 'In Prüfung oder gemeldet',
  reported: 'Gemeldet',
  ACTIVE: 'Sichtbar',
  PAUSED: 'Pausiert',
  CLOSED: 'Beendet',
  PENDING_REVIEW: 'In Prüfung',
  REJECTED: 'Abgelehnt',
  DRAFT: 'Entwürfe',
  all: 'Alle',
};

export const adminProjectQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z
    .string()
    .optional()
    .transform((v) => ((ADMIN_PROJECT_FILTERS as readonly string[]).includes(v ?? '') ? (v as AdminProjectFilter) : 'review')),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AdminProjectQuery = z.infer<typeof adminProjectQuerySchema>;

export interface AdminProjectSummary {
  id: string;
  title: string;
  status: ServiceProjectStatus;
  expired: boolean;
  client: PersonRef & { business: boolean; status: UserStatus };
  category: string;
  openReports: number;
  contactCount: number;
  updatedAt: string;
}

export interface AdminProjectDetail {
  project: ServiceProjectDetail;
  /** E-Mail nur für Administratoren */
  client: PersonRef & { email: string | null; business: boolean; status: UserStatus; createdAt: string };
  decisions: AdminDecision[];
  reports: AdminReportSummary[];
  contactCount: number;
  viewCount: number;
  /** Für Entscheidungen mitzuschicken (Schutz vor gleichzeitiger Bearbeitung) */
  version: string;
}
