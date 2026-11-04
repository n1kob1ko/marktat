import type { DealComparison, DealOffer } from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { dealInclude, dealJoinsSql, dealSellerName, dealSellerSql, dealVisibleSql, publicDealWhere, type DealWithRelations } from './deals.mapper.js';

/** Höchstens so viele andere Shops zeigt die Detailseite */
const MAX_OFFERS = 10;

/**
 * Preisvergleich über die GTIN/EAN: Je GTIN der Suchtreffer, wie viele Shops sie aktuell sichtbar anbieten und ab
 * welchem Preis. Nur GTINs mit mindestens zwei Shops (ein Shop mit Varianten ist kein Vergleich).
 */
export async function dealComparisons(prisma: PrismaService, gtins: string[]): Promise<Map<string, DealComparison>> {
  const unique = [...new Set(gtins)];
  if (!unique.length) return new Map();
  const rows = await prisma.$queryRaw<{ gtin: string; shops: bigint; lowest: number }[]>`
    SELECT dl.gtin, count(DISTINCT lower(${dealSellerSql})) AS shops, min(dl.price_cents) AS lowest
    FROM deals dl ${dealJoinsSql()}
    WHERE dl.gtin IN (${Prisma.join(unique)}) AND ${dealVisibleSql()}
    GROUP BY dl.gtin
    HAVING count(DISTINCT lower(${dealSellerSql})) > 1`;
  return new Map(rows.map((row) => [row.gtin, { shops: Number(row.shops), lowestPriceCents: Number(row.lowest) }]));
}

/** Dasselbe Produkt bei anderen Shops: je Shop das günstigste sichtbare Angebot, günstigste zuerst */
export async function otherDealOffers(prisma: PrismaService, deal: DealWithRelations): Promise<DealOffer[]> {
  if (!deal.gtin) return [];
  const rows = await prisma.deal.findMany({
    where: { ...publicDealWhere(), gtin: deal.gtin, id: { not: deal.id } },
    include: dealInclude,
    orderBy: [{ priceCents: 'asc' }, { id: 'asc' }],
    take: 50,
  });
  const own = dealSellerName(deal).toLocaleLowerCase('de');
  const seen = new Set([own]);
  const offers: DealOffer[] = [];
  for (const row of rows) {
    const seller = dealSellerName(row);
    const key = seller.toLocaleLowerCase('de');
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({ id: row.id, sellerName: seller, priceCents: row.priceCents, discountPercent: row.discountPercent, isAffiliateLink: row.isAffiliateLink });
    if (offers.length === MAX_OFFERS) break;
  }
  return offers;
}
