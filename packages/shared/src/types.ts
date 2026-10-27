import type {
  AccountType,
  ItemCondition,
  ListingStatus,
  PriceType,
  UserRole,
  Vertical,
} from './enums.js';

/** Antwort-Typen der REST-API. Datumsfelder werden als ISO-8601-Strings übertragen. */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
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
  name: string;
  vertical: Vertical;
  icon: string | null;
  children: CategoryNode[];
}

export interface LocationSummary {
  id: number;
  postalCode: string;
  place: string;
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
  category: { id: string; name: string; slug: string };
  location: LocationSummary | null;
  /** Vorschaubild (Hauptbild, 480 × 360) oder null */
  imageUrl: string | null;
  isBusiness: boolean;
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
  attributes: Record<string, string | number | boolean>;
  expiresAt: string | null;
  updatedAt: string;
  seller: PublicSeller;
  isOwner: boolean;
}
