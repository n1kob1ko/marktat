/**
 * DEMO-/TESTDATEN – ausschließlich für die lokale Entwicklung.
 * Der Demo-Verkäufer existiert nur in der App-Datenbank, nicht in Supabase Auth (kein Login möglich).
 */
import { DEFAULT_LISTING_DURATION_DAYS, slugify } from '@marktat/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export const DEMO_SELLER_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_NOTE = '\n\n[Testdaten – nur für die Entwicklung]';

const DEMO_LISTINGS = [
  { title: 'Citybike Damen 28 Zoll, 7-Gang', path: 'marktplatz/sport-freizeit/fahrraeder', price: 18000, priceType: 'NEGOTIABLE', postalCode: '1070', condition: 'GOOD' },
  { title: 'Ecksofa grau mit Schlaffunktion', path: 'marktplatz/moebel-wohnen/sofas-sessel', price: 35000, priceType: 'FIXED', postalCode: '8010', condition: 'GOOD' },
  { title: 'iPhone 14, 128 GB, sehr guter Zustand', path: 'marktplatz/elektronik/handys-smartphones', price: 42000, priceType: 'FIXED', postalCode: '4020', condition: 'LIKE_NEW' },
  { title: 'Kinderwagen Kombi inkl. Babywanne', path: 'marktplatz/baby-kind/kinderwagen', price: 12000, priceType: 'NEGOTIABLE', postalCode: '5020', condition: 'GOOD' },
  { title: 'Ski Allmountain 170 cm mit Bindung', path: 'marktplatz/sport-freizeit/wintersport', price: 15000, priceType: 'FIXED', postalCode: '6020', condition: 'GOOD' },
  { title: 'Gartenmöbel-Set Teak, 4 Sessel', path: 'marktplatz/garten/gartenmoebel', price: null, priceType: 'FREE', postalCode: '9020', condition: 'ACCEPTABLE' },
  { title: 'Nachhilfe Mathematik Oberstufe', path: 'marktplatz/dienstleistungen/nachhilfe-unterricht', price: 2500, priceType: 'FIXED', postalCode: '1090', condition: null },
  { title: 'Waschmaschine 7 kg, A+++', path: 'marktplatz/haushalt/haushaltsgeraete', price: 19000, priceType: 'NEGOTIABLE', postalCode: '6850', condition: 'GOOD' },
] as const;

export async function seedDemoData(prisma: PrismaClient) {
  await prisma.user.upsert({
    where: { id: DEMO_SELLER_ID },
    update: {},
    create: {
      id: DEMO_SELLER_ID,
      email: 'demo-verkaeufer@marktat.local',
      displayName: 'Demo-Verkäufer (Testdaten)',
    },
  });
  await prisma.listing.deleteMany({ where: { sellerId: DEMO_SELLER_ID } });
  const now = Date.now();
  for (const [i, item] of DEMO_LISTINGS.entries()) {
    const category = await prisma.category.findUniqueOrThrow({ where: { path: item.path } });
    const location = await prisma.location.findFirstOrThrow({ where: { postalCode: item.postalCode } });
    const publishedAt = new Date(now - i * 3_600_000);
    await prisma.listing.create({
      data: {
        sellerId: DEMO_SELLER_ID,
        categoryId: category.id,
        vertical: category.vertical,
        title: item.title,
        slug: slugify(item.title),
        description: `Beispielinserat „${item.title}“. Abholung vor Ort, Versand nach Absprache.${DEMO_NOTE}`,
        priceType: item.priceType,
        priceCents: item.price === null ? null : BigInt(item.price),
        condition: item.condition,
        locationId: location.id,
        status: 'ACTIVE',
        publishedAt,
        expiresAt: new Date(publishedAt.getTime() + DEFAULT_LISTING_DURATION_DAYS * 86_400_000),
      },
    });
  }
  console.log(`Demo: ${DEMO_LISTINGS.length} Testinserate angelegt`);
}
