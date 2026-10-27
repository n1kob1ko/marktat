import { BadRequestException } from '@nestjs/common';
import {
  DEAL_DISCOUNT_REVIEW_PERCENT,
  dealCompleteSchema,
  dealDiscountPercent,
  dealEndsAt,
  dealStartsAt,
  slugify,
  toViennaDay,
  type DealFields,
} from '@marktat/shared';
import type { Deal, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Automatische Prüfung wegen sehr hohen Rabatts – wird aufgehoben, sobald der Rabatt wieder darunter liegt */
export const DISCOUNT_REVIEW_REASON = `Rabatt ab ${DEAL_DISCOUNT_REVIEW_PERCENT} %: Das Team prüft den Vergleichspreis, bevor das Angebot erscheint.`;
/** Nach einer Ablehnung überarbeitet – nur das Team gibt frei */
export const RESUBMIT_REVIEW_REASON = 'Nach einer Ablehnung überarbeitet – wartet auf die Prüfung durch das Team.';

export interface FieldIssue {
  path: string;
  message: string;
}

export class DealFieldError extends BadRequestException {
  constructor(
    message: string,
    readonly issues: FieldIssue[],
  ) {
    super({ statusCode: 400, message, errors: issues });
  }
}

/** Gespeicherter Stand als Formularwerte (für Bearbeiten: Änderungen werden darübergelegt und vollständig geprüft) */
export function currentDealFields(deal: Deal & { category: { slug: string }; stores: { storeId: string }[] }): DealFields {
  return {
    title: deal.title,
    description: deal.description,
    categorySlug: deal.category.slug,
    channel: deal.channel,
    url: deal.url,
    isAffiliateLink: deal.isAffiliateLink,
    priceCents: deal.priceCents,
    unitPriceText: deal.unitPriceText,
    shippingNote: deal.shippingNote,
    referencePriceCents: deal.referencePriceCents,
    referencePriceType: deal.referencePriceType === 'MARKET_CHECK' ? null : deal.referencePriceType,
    referencePriceSource: deal.referencePriceSource,
    referencePriceEvidenceUrl: deal.referencePriceEvidenceUrl,
    availability: deal.availability,
    startsOn: toViennaDay(deal.startsAt),
    endsOn: toViennaDay(deal.endsAt),
    storeIds: deal.stores.map((s) => s.storeId),
    brand: deal.brand,
    gtin: deal.gtin,
    externalId: deal.externalId,
  };
}

/** Vollständige Prüfung (gleiche Regeln wie Formular und Import); wirft 400 mit allen Feldfehlern */
export function parseCompleteDeal(fields: unknown): DealFields {
  const result = dealCompleteSchema.safeParse(fields);
  if (!result.success) {
    throw new DealFieldError(
      'Bitte prüfe die Angaben zum Angebot.',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export interface PreparedDeal {
  data: Omit<Prisma.DealUncheckedCreateInput, 'merchantId' | 'status' | 'source'>;
  storeIds: string[];
  discountPercent: number | null;
}

/**
 * Formularwerte → Datenbankfelder. Kategorie und Filialen werden gegen die Datenbank geprüft (nur eigene,
 * nicht gelöschte Filialen). Der Rabatt wird hier berechnet – nie aus der Eingabe übernommen.
 */
export async function prepareDeal(prisma: PrismaService | Prisma.TransactionClient, merchantId: string, fields: DealFields): Promise<PreparedDeal> {
  const issues: FieldIssue[] = [];
  const category = await prisma.dealCategory.findFirst({ where: { slug: fields.categorySlug, isActive: true }, select: { id: true } });
  if (!category) issues.push({ path: 'categorySlug', message: 'Diese Kategorie gibt es nicht.' });
  const local = fields.channel !== 'ONLINE';
  const storeIds = local ? [...new Set(fields.storeIds ?? [])] : [];
  if (storeIds.length) {
    const own = await prisma.dealerStore.count({ where: { id: { in: storeIds }, merchantId, deletedAt: null } });
    if (own !== storeIds.length) issues.push({ path: 'storeIds', message: 'Mindestens eine gewählte Filiale gibt es nicht (mehr).' });
  }
  if (issues.length) throw new DealFieldError('Bitte prüfe die Angaben zum Angebot.', issues);
  const hasReference = Boolean(fields.referencePriceCents && fields.referencePriceType);
  const discountPercent = dealDiscountPercent(fields.priceCents, fields.referencePriceCents, fields.referencePriceType);
  return {
    storeIds,
    discountPercent,
    data: {
      categoryId: category!.id,
      title: fields.title,
      slug: slugify(fields.title),
      description: fields.description ?? '',
      brand: fields.brand ?? null,
      gtin: fields.gtin ?? null,
      externalId: fields.externalId ?? null,
      channel: fields.channel,
      url: fields.channel === 'LOCAL' ? (fields.url ?? null) : fields.url!,
      isAffiliateLink: fields.channel === 'LOCAL' ? false : Boolean(fields.isAffiliateLink),
      priceCents: fields.priceCents,
      unitPriceText: fields.unitPriceText ?? null,
      shippingNote: fields.shippingNote ?? null,
      referencePriceCents: hasReference ? fields.referencePriceCents! : null,
      referencePriceType: hasReference ? fields.referencePriceType! : null,
      referencePriceSource: hasReference ? (fields.referencePriceSource ?? null) : null,
      referencePriceEvidenceUrl: hasReference ? (fields.referencePriceEvidenceUrl ?? null) : null,
      discountPercent,
      availability: fields.availability ?? 'UNKNOWN',
      startsAt: dealStartsAt(fields.startsOn),
      endsAt: dealEndsAt(fields.endsOn),
    },
  };
}

/** Sehr hoher Rabatt → vor dem Erscheinen prüfen */
export function needsDiscountReview(discountPercent: number | null) {
  return discountPercent !== null && discountPercent >= DEAL_DISCOUNT_REVIEW_PERCENT;
}

/**
 * Status nach einer Änderung (Formular, Import, Feed): erneute Prüfung nur, wenn sich Preis oder Vergleichspreis
 * ändern und der Rabatt sehr hoch ist; eine automatische Prüfung entfällt, sobald der Rabatt wieder darunter liegt.
 * Ein vom Team freigegebener Rabatt bleibt damit freigegeben, solange der Preis gleich bleibt.
 */
export function statusAfterChange(
  current: Pick<Deal, 'status' | 'reviewReason'>,
  discountPercent: number | null,
  priceChanged: boolean,
): Pick<Deal, 'status' | 'reviewReason'> {
  if (current.status === 'ACTIVE' && priceChanged && needsDiscountReview(discountPercent)) return { status: 'PENDING_REVIEW', reviewReason: DISCOUNT_REVIEW_REASON };
  if (current.status === 'PENDING_REVIEW' && current.reviewReason === DISCOUNT_REVIEW_REASON && !needsDiscountReview(discountPercent)) return { status: 'ACTIVE', reviewReason: null };
  return { status: current.status, reviewReason: current.reviewReason };
}

/** Filialzuordnung ersetzen */
export async function replaceDealStores(tx: Prisma.TransactionClient, dealId: string, storeIds: string[]) {
  await tx.dealStore.deleteMany({ where: { dealId, storeId: { notIn: storeIds } } });
  if (storeIds.length) await tx.dealStore.createMany({ data: storeIds.map((storeId) => ({ dealId, storeId })), skipDuplicates: true });
}
