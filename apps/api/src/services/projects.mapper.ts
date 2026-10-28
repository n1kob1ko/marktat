import { PROJECT_MAX_CONTACTS, type ServiceProjectDetail, type ServiceProjectSummary } from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { providerName, toServiceCategoryView } from './services.mapper.js';
import { isProjectPublic } from './visibility.js';

export const projectInclude = {
  user: { select: { id: true, displayName: true, accountType: true, companyName: true, status: true, deletedAt: true, createdAt: true } },
  category: true,
  location: { include: locationInclude },
  _count: { select: { conversations: true } },
} satisfies Prisma.ServiceProjectInclude;

export type ProjectRow = Prisma.ServiceProjectGetPayload<{ include: typeof projectInclude }>;

type Center = { latitude: number; longitude: number } | null;

const EXCERPT_LENGTH = 240;

function excerpt(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : flat;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function toProjectSummary(row: ProjectRow, center: Center = null): ServiceProjectSummary {
  return {
    id: row.id,
    title: row.title,
    excerpt: excerpt(row.description),
    category: toServiceCategoryView(row.category),
    location: row.location ? toLocationSummary(row.location) : null,
    remote: row.remote,
    budgetType: row.budgetType,
    budgetCents: row.budgetCents,
    timeframe: row.timeframe,
    client: { id: row.user.id, name: providerName(row.user), business: row.user.accountType === 'BUSINESS', memberSince: row.user.createdAt.toISOString() },
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    acceptsContacts: row._count.conversations < PROJECT_MAX_CONTACTS,
    distanceKm: center && row.location ? distanceKm(center, row.location) : null,
  };
}

export function toProjectDetail(
  row: ProjectRow,
  options: { isOwner: boolean; conversationId: string | null; contact: ServiceProjectDetail['contact'] },
): ServiceProjectDetail {
  return {
    ...toProjectSummary(row),
    status: row.status,
    description: row.description,
    closedAt: row.closedAt?.toISOString() ?? null,
    isPublic: isProjectPublic(row),
    isOwner: options.isOwner,
    conversationId: options.conversationId,
    contact: options.contact,
    moderation: null,
  };
}
