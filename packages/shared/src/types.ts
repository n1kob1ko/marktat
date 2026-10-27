import type {
  AccountType,
  ItemCondition,
  ListingStatus,
  PriceType,
  UserRole,
  Vertical,
} from './enums.js';
import type { ListingAttributes } from './attributes/types.js';
import type { ReportReason } from './schemas/interactions.js';
import type {
  AppealStatus,
  DecisionGround,
  ModerationAction,
  NotificationType,
  ReportEventType,
  ReportPriority,
  ReportStatus,
  ReportTarget,
  UserStatus,
} from './schemas/moderation.js';

/** Antwort-Typen der REST-API. Datumsfelder werden als ISO-8601-Strings übertragen. */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Ergebnis von `GET /v1/listings` */
export interface SearchResult extends Paginated<ListingSummary> {
  /** Anzahl erreichbarer Seiten (bei sehr vielen Treffern begrenzt) */
  totalPages: number;
  /** Gewählter Ort bzw. Mittelpunkt der Umkreissuche */
  location: LocationSummary | null;
  /** Welche Suche geantwortet hat; `postgres` = Ausweichbetrieb ohne Meilisearch */
  engine: 'meilisearch' | 'postgres';
}

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: { path: string; message: string }[];
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  accountType: AccountType;
  role: UserRole;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  companyName: string | null;
  companyRegisterNumber: string | null;
  vatId: string | null;
  companyAddress: string | null;
  /** E-Mail bei neuen Nachrichten */
  notifyMessagesByEmail: boolean;
  /** E-Mail bei neuen Treffern gespeicherter Suchen (je Suche einzeln aktivierbar) */
  notifySearchesByEmail: boolean;
  /** SUSPENDED: nur Konto-Status, Entscheidungen, Einspruch, Datenexport und Löschung sind erreichbar */
  status: UserStatus;
  /** Aktuelle Sperre mit Begründung (nur bei status = SUSPENDED) */
  suspension: { decisionId: string | null; statement: string | null; since: string } | null;
  createdAt: string;
}

export interface PublicSeller {
  id: string;
  displayName: string;
  accountType: AccountType;
  companyName: string | null;
  avatarUrl: string | null;
  memberSince: string;
}

export interface CategoryNode {
  id: string;
  slug: string;
  /** Eindeutiger Pfad, z. B. „auto-motor/gebrauchtwagen“; bestimmt die Zusatzfelder */
  path: string;
  name: string;
  vertical: Vertical;
  icon: string | null;
  children: CategoryNode[];
}

export interface LocationSummary {
  id: number;
  postalCode: string;
  place: string;
  /** Gemeinde, falls sie anders heißt als der Ort (z. B. „Innsbruck“ beim Ortsteil „Wilten“) */
  municipality: string | null;
  district: string;
  state: string;
  stateCode: string;
}

export interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  /** null bei Entwürfen ohne Preisangabe */
  priceType: PriceType | null;
  priceCents: number | null;
  status: ListingStatus;
  vertical: Vertical;
  category: { id: string; name: string; slug: string; path: string };
  location: LocationSummary | null;
  /** Vorschaubild (Hauptbild, 480 × 360) oder null */
  imageUrl: string | null;
  isBusiness: boolean;
  /** Kurzinfos aus den Zusatzangaben, z. B. [„03/2019“, „85.000 km“, „Diesel“] */
  facts: string[];
  /** Zusatz zum Preis, z. B. „pro Monat“ bei Miete */
  priceSuffix: string | null;
  /** Nur Jobs: Gehaltsangabe statt Preis */
  salary: string | null;
  /** Nur bei Suchen mit Ort: Luftlinie zum gewählten Ort in km */
  distanceKm?: number | null;
  publishedAt: string | null;
  createdAt: string;
}

/** Ein fertig verarbeitetes Bild. URLs zeigen nie auf die unverarbeitete Originaldatei. */
export interface ListingImage {
  id: string;
  /** Große Ansicht, max. 1600 px Kantenlänge */
  url: string;
  /** Vorschaubild 480 × 360 */
  thumbUrl: string;
  width: number;
  height: number;
  /** 0 = Hauptbild */
  position: number;
}

/** Antwort auf die Upload-Anmeldung: Datei per HTTP PUT mit genau diesen Headern hochladen. */
export interface ImageUploadTicket {
  imageId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  images: ListingImage[];
  condition: ItemCondition | null;
  /** Gespeicherte Zusatzangaben; Anzeige über `describeListingAttributes` */
  attributes: ListingAttributes;
  expiresAt: string | null;
  updatedAt: string;
  seller: PublicSeller;
  isOwner: boolean;
  /** Nur für angemeldete Personen: ob das Inserat gemerkt ist */
  isFavorite: boolean;
  /** Nur für angemeldete Interessenten: bestehende Unterhaltung zu diesem Inserat */
  conversationId: string | null;
  /** Nur für Eigentümer und Moderation: letzte Moderationsentscheidung (bei REJECTED/PENDING_REVIEW) */
  moderation: ListingModerationInfo | null;
}

export interface ListingModerationInfo {
  decisionId: string;
  action: ModerationAction;
  reason: ReportReason | null;
  statement: string;
  createdAt: string;
  appealStatus: AppealStatus | null;
  /** Abgelehntes Inserat kann nach einer Überarbeitung zur erneuten Prüfung eingereicht werden */
  canResubmit: boolean;
}

// ---------------------------------------------------------------------------
// Merkliste und gespeicherte Suchen
// ---------------------------------------------------------------------------

export interface FavoriteItem {
  /** Bei nicht mehr verfügbaren Inseraten ohne Bild */
  listing: ListingSummary;
  /** false = pausiert, abgelaufen, gelöscht oder Verkäufer nicht mehr aktiv */
  available: boolean;
  savedAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  /** Parameter der Such-URL (`/suche?…`) */
  params: Record<string, string>;
  /** Lesbare Filter, z. B. [„Gebrauchtwagen“, „Preis bis € 20.000“] */
  labels: string[];
  notify: boolean;
  createdAt: string;
  lastNotifiedAt: string | null;
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  conversationId: string;
  body: string;
  /** Von der angemeldeten Person geschrieben */
  mine: boolean;
  createdAt: string;
  /** Vom Empfänger gelesen */
  readAt: string | null;
}

export interface ConversationPartner {
  id: string;
  displayName: string;
  /** Konto gelöscht oder gesperrt */
  inactive: boolean;
}

export interface ConversationSummary {
  id: string;
  /** Rolle der angemeldeten Person: Interessent (buyer) oder Anbieter (seller) */
  role: 'buyer' | 'seller';
  partner: ConversationPartner;
  listing: {
    id: string;
    title: string;
    imageUrl: string | null;
    priceType: ListingSummary['priceType'];
    priceCents: number | null;
    /** false = nicht mehr öffentlich (pausiert, abgelaufen, gelöscht) */
    available: boolean;
  };
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  /** Ob die angemeldete Person die andere blockiert hat */
  blockedByMe: boolean;
  /** null = Senden möglich, sonst der Grund (für die Anzeige) */
  sendBlockedReason: string | null;
}

export interface MessagePage {
  items: ChatMessage[];
  /** Es gibt ältere Nachrichten (`before` = id der ältesten geladenen) */
  hasMore: boolean;
}

export interface UnreadSummary {
  /** Ungelesene Nachrichten insgesamt */
  messages: number;
  /** Unterhaltungen mit ungelesenen Nachrichten */
  conversations: number;
}

/** Ereignisse über `GET /v1/me/events` (Server-Sent Events) */
export type RealtimeEvent =
  | { type: 'ready'; unread: UnreadSummary }
  | { type: 'message'; message: ChatMessage; unread: UnreadSummary }
  /** byMe: in einem anderen Fenster selbst gelesen; sonst hat die andere Person meine Nachrichten gelesen */
  | { type: 'read'; conversationId: string; readAt: string; byMe: boolean; unread: UnreadSummary }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Moderation, Einsprüche, Mitteilungen (Phase 6)
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  displayName: string;
}

/** Entscheidung aus Sicht der betroffenen Person (Begründung nach Art. 17 DSA) */
export interface ModerationDecisionView {
  id: string;
  action: ModerationAction;
  reason: ReportReason | null;
  ground: DecisionGround | null;
  statement: string;
  createdAt: string;
  listing: { id: string; title: string } | null;
  appeal: AppealView | null;
  /** Einspruch ist noch möglich (einschränkende Maßnahme, Frist offen, noch kein Einspruch) */
  canAppeal: boolean;
  appealDeadline: string | null;
  /** Wurde durch eine spätere Entscheidung aufgehoben */
  reversed: boolean;
}

export interface AppealView {
  id: string;
  status: AppealStatus;
  body: string;
  response: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

/** Entscheidung im Admin-Bereich (mit internen Angaben) */
export interface AdminDecision extends ModerationDecisionView {
  internalNote: string | null;
  moderator: PersonRef | null;
  user: PersonRef;
  snapshot: Record<string, unknown> | null;
}

export interface AdminReportSummary {
  id: string;
  targetType: ReportTarget;
  reason: ReportReason;
  status: ReportStatus;
  priority: ReportPriority;
  details: string | null;
  createdAt: string;
  listing: { id: string; title: string; status: string } | null;
  conversationId: string | null;
  reported: (PersonRef & { status: UserStatus }) | null;
  reporter: PersonRef | null;
  assignee: PersonRef | null;
  /** Weitere offene Meldungen zum selben Inhalt */
  relatedOpen: number;
}

export interface ReportEventItem {
  id: string;
  type: ReportEventType;
  actor: PersonRef | null;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  note: string | null;
  createdAt: string;
}

export interface AdminReportDetail extends AdminReportSummary {
  abusive: boolean;
  resolutionNote: string | null;
  handledAt: string | null;
  handledBy: PersonRef | null;
  events: ReportEventItem[];
  decision: AdminDecision | null;
  /** Andere Meldungen zum selben Inhalt (neueste zuerst) */
  related: AdminReportSummary[];
  /** Meldeverhalten der meldenden Person (Art. 23 DSA) */
  reporterStats: { total: number; abusive: number; blockedUntil: string | null } | null;
  /** Nachrichten der gemeldeten Unterhaltung dürfen geöffnet werden (nur solange die Meldung bearbeitet wird) */
  canViewMessages: boolean;
}

export interface ReportedMessage {
  id: string;
  /** Wer hat geschrieben – aus Sicht der Meldung */
  author: 'reporter' | 'reported';
  body: string;
  createdAt: string;
}

export interface ReportedConversation {
  listing: { id: string; title: string } | null;
  messages: ReportedMessage[];
  /** Nur Nachrichten bis zum Zeitpunkt der Meldung; ältere als die letzten 100 fehlen */
  truncated: boolean;
}

export interface AdminListingSummary {
  id: string;
  title: string;
  /** Wirksamer Status (abgelaufene aktive Inserate = EXPIRED) */
  status: ListingStatus;
  thumbUrl: string | null;
  seller: PersonRef & { status: UserStatus };
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  openReports: number;
}

export interface AdminListingDetail {
  listing: ListingDetail;
  seller: PersonRef & { status: UserStatus; createdAt: string; email: string | null };
  decisions: AdminDecision[];
  reports: AdminReportSummary[];
  /** Für Entscheidungen mitzuschicken (Schutz vor gleichzeitiger Bearbeitung) */
  version: string;
}

export interface AdminUserSummary {
  id: string;
  displayName: string;
  /** Nur für Administratoren */
  email: string | null;
  role: UserRole;
  status: UserStatus;
  accountType: AccountType;
  createdAt: string;
  lastSeenAt: string | null;
  activeListings: number;
  openReports: number;
}

export interface AdminUserDetail extends AdminUserSummary {
  companyName: string | null;
  listings: AdminListingSummary[];
  reportsReceived: AdminReportSummary[];
  reportsMade: { total: number; abusive: number };
  reportingBlockedUntil: string | null;
  decisions: AdminDecision[];
  deletion: { status: 'PENDING' | 'COMPLETED' | 'FAILED'; requestedAt: string } | null;
}

export interface AdminAppealItem {
  id: string;
  status: AppealStatus;
  body: string;
  response: string | null;
  createdAt: string;
  decidedAt: string | null;
  user: PersonRef & { status: UserStatus };
  reviewer: PersonRef | null;
  decision: AdminDecision;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: PersonRef | null;
  entityType: string | null;
  entityId: string | null;
  ipPrefix: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface JobFailure {
  name: string;
  reason: string;
  attempts: number;
  failedAt: string | null;
}

export interface AdminDashboard {
  /** Für Moderation und Administration */
  moderation: {
    listings: { active: number; paused: number; expired: number; pendingReview: number; rejected: number; draft: number };
    reports: { open: number; inReview: number; urgent: number; reportedListings: number };
    appeals: { open: number };
  };
  /** Nur für Administratoren (Systemstatistiken) */
  system: {
    users: { total: number; active: number; suspended: number; deleted: number; staff: number; new7d: number; new30d: number };
    /** Registrierungen der letzten 14 Tage (ältester Tag zuerst) */
    registrations: { date: string; count: number }[];
    deletions: { pending: number; failed: number };
    jobs: { backend: 'redis' | 'memory'; waiting: number; delayed: number; failed: number; recentFailures: JobFailure[] };
    /** Wichtige Ereignisse aus dem Audit-Log */
    events: AuditEntry[];
  } | null;
}
