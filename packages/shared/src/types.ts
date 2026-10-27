import type {
  AccountType,
  ItemCondition,
  ListingStatus,
  PriceType,
  UserRole,
  Vertical,
} from './enums.js';
import type { ListingAttributes } from './attributes/types.js';

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
  | { type: 'read'; conversationId: string; readAt: string; unread: UnreadSummary }
  | { type: 'ping' };
