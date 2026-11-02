import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ArrowRight, Briefcase, ChevronRight, Gift, LayoutGrid, Car, Camera, House, MessageCircle, Percent, ShieldCheck, ShoppingBag, Store, Tag, Wrench } from 'lucide-react';
import { buttonClasses, Container, Skeleton } from '@marktat/ui';
import { VERTICAL_SLUGS } from '@marktat/shared';
import { SearchHero } from '@/components/search-hero';
import { TopoPattern } from '@/components/topo-pattern';
import { ListingCard } from '@/components/listing-card';
import { CategoryIcon } from '@/components/category-icon';
import { getCategories, getCategoryCounts, getLatestDeals, getLatestListings } from '@/lib/data';
import { DealCard } from '@/components/deals/deal-card';
import { getPublicBilling } from '@/lib/billing';
import { IntroBanner } from '@/components/billing/intro-banner';

/** Die sechs Bereiche als eine Icon-Reihe; Kleinanzeigen-Bereiche zeigen die Zahl ihrer Anzeigen */
const VERTICAL_TILES = [
  { slug: VERTICAL_SLUGS.MARKETPLACE, href: `/suche?bereich=${VERTICAL_SLUGS.MARKETPLACE}`, title: 'Marktplatz', hint: 'Möbel, Mode & mehr', icon: ShoppingBag, tone: 'bg-brand-50 text-brand-700' },
  { slug: VERTICAL_SLUGS.VEHICLES, href: `/suche?bereich=${VERTICAL_SLUGS.VEHICLES}`, title: 'Auto & Motor', hint: 'Autos & Motorräder', icon: Car, tone: 'bg-accent-50 text-accent-700' },
  { slug: VERTICAL_SLUGS.REAL_ESTATE, href: `/suche?bereich=${VERTICAL_SLUGS.REAL_ESTATE}`, title: 'Immobilien', hint: 'Mieten & kaufen', icon: House, tone: 'bg-[#eef2fb] text-[#2f4a8a] dark:bg-[#1a2238] dark:text-[#a9bdf0]' },
  { slug: VERTICAL_SLUGS.JOBS, href: `/suche?bereich=${VERTICAL_SLUGS.JOBS}`, title: 'Jobs', hint: 'Voll- & Teilzeit', icon: Briefcase, tone: 'bg-[#f6eefb] text-[#6b3a8a] dark:bg-[#26182f] dark:text-[#d3b0ea]' },
  { slug: 'deals', href: '/deals', title: 'Deals', hint: 'Angebote von Händlern', icon: Percent, tone: 'bg-[#fdf0ec] text-[#9a3b1c] dark:bg-[#2e1a13] dark:text-[#f2ad92]' },
  { slug: 'dienstleistungen', href: '/dienstleistungen', title: 'Dienstleistungen', hint: 'Handwerk, Nachhilfe', icon: Wrench, tone: 'bg-[#ecf6f4] text-[#1f6656] dark:bg-[#11261f] dark:text-[#93d5c4]' },
];


export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-hero text-white">
        <TopoPattern className="absolute inset-0 -z-10 size-full text-white/[0.07]" />
        <div aria-hidden="true" className="absolute -top-40 -right-40 -z-10 size-[32rem] rounded-full bg-accent-500/15 blur-3xl" />
        {/* Kompakter Kopf: Suche im Mittelpunkt, damit Bereiche und erste Anzeigen schon im ersten Bildschirm stehen */}
        <Container className="pt-8 pb-16 sm:pt-11 sm:pb-20">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <h1 className="text-3xl leading-[1.05] font-bold sm:text-4xl lg:text-[2.75rem]">
              Gutes findet man <span className="text-accent-300">um die Ecke.</span>
            </h1>
            <p className="hidden max-w-md text-[0.9375rem] leading-relaxed text-hero-muted sm:block lg:text-right">
              Kostenlos inserieren, in der Nähe finden, fair handeln. Kleinanzeigen aus allen neun Bundesländern.
            </p>
          </div>
          <div className="mt-6">
            <SearchHero />
          </div>
        </Container>
      </section>

      <Container className="relative z-10 -mt-10">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--shadow-card)] sm:p-3">
          <Suspense fallback={<AreaTiles counts={{}} />}>
            <AreaTilesWithCounts />
          </Suspense>
        </div>
      </Container>

      <Container className="mt-12">
        <SectionHeading
          title="Neu eingestellt"
          action={
            <Link href="/suche" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Alle Anzeigen <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
        <Suspense fallback={<GridSkeleton count={10} className="h-64" />}>
          <LatestListings />
        </Suspense>
      </Container>

      <Container className="mt-14">
        <SectionHeading title="Alle Kategorien im Marktplatz" />
        <Suspense fallback={<GridSkeleton count={9} className="h-16" />}>
          <MarketplaceCategories />
        </Suspense>
      </Container>

      <Container className="mt-14">
        <SectionHeading
          title="Aktuelle Deals & Angebote"
          action={
            <Link href="/deals" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Alle Deals <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
        <Suspense fallback={<GridSkeleton count={4} className="h-80" />}>
          <LatestDeals />
        </Suspense>
      </Container>

      <Suspense fallback={null}>
        <HomeIntro />
      </Suspense>

      <Container className="mt-20">
        <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10">
            <h2 className="text-2xl font-bold text-ink-950 sm:text-3xl">In drei Schritten verkauft</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {[
                { icon: Camera, title: 'Fotografieren', text: 'Gute Fotos bei Tageslicht – das wirkt sofort vertrauenswürdig.' },
                { icon: Tag, title: 'Inserieren', text: 'Titel, Preis und Ort eingeben – die Vorschau zeigt sofort, wie es aussieht.' },
                { icon: MessageCircle, title: 'Verkaufen', text: 'Anfragen beantworten, Treffpunkt ausmachen, fertig.' },
              ].map((step, i) => (
                <li key={step.title}>
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 flex items-center gap-2 font-sans text-base font-semibold tracking-normal text-ink-900">
                    <step.icon className="size-4.5 text-brand-600" aria-hidden="true" /> {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{step.text}</p>
                </li>
              ))}
            </ol>
            <Suspense
              fallback={
                <Link href="/inserieren" className={buttonClasses({ size: 'lg', className: 'mt-8' })}>
                  Jetzt inserieren
                </Link>
              }
            >
              <ListCta />
            </Suspense>
          </div>
          <div className="flex flex-col gap-6">
            <div className="rounded-[var(--radius-card)] bg-accent-50 p-6 sm:p-8">
              <ShieldCheck className="size-7 text-accent-700" aria-hidden="true" />
              <h2 className="mt-3 font-sans text-lg font-semibold tracking-normal text-ink-950">Sicher handeln</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-700">
                <li>Ware wenn möglich persönlich ansehen und übergeben.</li>
                <li>Keine Vorauszahlung an unbekannte Personen, keine Codes per SMS weitergeben.</li>
                <li>Verdächtige Anzeigen über „Melden“ an unser Team schicken.</li>
              </ul>
            </div>
            <div className="rounded-[var(--radius-card)] bg-hero-deep p-6 text-white sm:p-8">
              <Store className="size-7 text-accent-300" aria-hidden="true" />
              <h2 className="mt-3 font-sans text-lg font-semibold tracking-normal">Für Händler & Unternehmen</h2>
              <p className="mt-2 text-sm leading-relaxed text-hero-muted">
                Gewerbliches Konto mit Firmenprofil, gekennzeichneten Angeboten und bald auch Anzeigenpaketen.
              </p>
              <Link href="/registrieren" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-300 hover:underline">
                Gewerbekonto erstellen <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}

async function AreaTilesWithCounts() {
  return <AreaTiles counts={await getCategoryCounts()} />;
}

function AreaTiles({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="grid grid-cols-3 gap-1 sm:grid-cols-6">
      {VERTICAL_TILES.map((tile) => {
        const count = counts[tile.slug];
        return (
          <li key={tile.slug} className="flex">
            <Link
              href={tile.href}
              className="group flex w-full flex-col items-center gap-2 rounded-xl px-1 py-3 text-center transition-colors hover:bg-canvas sm:py-4"
            >
              <span className={`flex size-12 items-center justify-center rounded-2xl transition-transform group-hover:-translate-y-0.5 ${tile.tone}`}>
                <tile.icon className="size-6" aria-hidden="true" />
              </span>
              <span className="text-sm leading-tight font-semibold text-ink-900">{tile.title}</span>
              <span className="hidden text-xs leading-tight text-ink-500 tabular-nums sm:block">
                {count ? `${count.toLocaleString('de-AT')} ${count === 1 ? 'Anzeige' : 'Anzeigen'}` : tile.hint}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Einführungsaktion nur, solange sie im Admin-Bereich aktiv und sichtbar ist */
async function HomeIntro() {
  const billing = await getPublicBilling();
  if (!billing?.intro) return null;
  return (
    <Container className="mt-16">
      <IntroBanner intro={billing.intro} />
    </Container>
  );
}

/** „kostenlos“ nur, wenn Inserieren tatsächlich nichts kostet */
async function ListCta() {
  const billing = await getPublicBilling();
  const free = billing ? !billing.products.find((p) => p.code === 'listing')?.requiresPayment : false;
  return (
    <Link href="/inserieren" className={buttonClasses({ size: 'lg', className: 'mt-8' })}>
      {free ? 'Jetzt kostenlos inserieren' : 'Jetzt inserieren'}
    </Link>
  );
}

function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="text-2xl font-bold text-ink-950 sm:text-[1.75rem]">{title}</h2>
      {action}
    </div>
  );
}

function GridSkeleton({ count, className }: { count: number; className: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}

/**
 * Alle Kategorien des Marktplatzes als Liste mit Icon, Anzahl der Anzeigen und den ersten Unterkategorien.
 * Jede Zeile führt auf die Kategorieseite (Unterkategorien mit Anzahl, darunter die Anzeigen mit Filtern).
 */
async function MarketplaceCategories() {
  const [all, counts] = await Promise.all([getCategories(), getCategoryCounts()]);
  const categories = all.filter((c) => c.vertical === 'MARKETPLACE');
  if (!categories.length) {
    return <p className="text-ink-500">Kategorien sind gerade nicht verfügbar.</p>;
  }
  const total = counts[VERTICAL_SLUGS.MARKETPLACE] ?? 0;
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-2 sm:p-3">
      <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <li key={category.id}>
            <CategoryRow
              href={`/suche?kategorie=${category.path}`}
              icon={<CategoryIcon name={category.icon} className="size-5" />}
              name={category.name}
              count={counts[category.path]}
              hint={category.children.slice(0, 3).map((c) => c.name).join(', ')}
            />
          </li>
        ))}
        <li>
          <CategoryRow
            href={`/suche?bereich=${VERTICAL_SLUGS.MARKETPLACE}&preis_bis=0`}
            icon={<Gift className="size-5" aria-hidden="true" />}
            name="Zu verschenken"
            hint="Kostenlos abzuholen"
          />
        </li>
        <li>
          <CategoryRow
            href={`/suche?bereich=${VERTICAL_SLUGS.MARKETPLACE}`}
            icon={<LayoutGrid className="size-5" aria-hidden="true" />}
            name="Alle Anzeigen"
            count={total}
            hint="Alles aus dem Marktplatz, neueste zuerst"
          />
        </li>
      </ul>
    </div>
  );
}

function CategoryRow({ href, icon, name, count, hint }: { href: string; icon: React.ReactNode; name: string; count?: number; hint?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-brand-50 sm:px-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-primary group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-semibold text-ink-900 group-hover:text-brand-800">{name}</span>
          {count ? (
            <span className="text-xs text-ink-500 tabular-nums">
              {count.toLocaleString('de-AT')}
              <span className="sr-only"> {count === 1 ? 'Anzeige' : 'Anzeigen'}</span>
            </span>
          ) : null}
        </span>
        {hint ? <span className="mt-0.5 block truncate text-xs text-ink-500">{hint}</span> : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />
    </Link>
  );
}

async function LatestListings() {
  const listings = await getLatestListings(10);
  if (!listings.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
        <p className="font-semibold text-ink-900">Noch keine Anzeigen</p>
        <p className="mt-1 text-sm text-ink-500">Sei die erste Person, die hier etwas anbietet.</p>
        <Link href="/inserieren" className={buttonClasses({ className: 'mt-5' })}>
          Inserat aufgeben
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {listings.map((listing) => (
        <li key={listing.id} className="flex">
          <ListingCard listing={listing} />
        </li>
      ))}
    </ul>
  );
}

/** Nur tatsächlich aktive, bestätigte Deals (die API liefert keine anderen); ohne Deals ein Hinweis für Händler */
async function LatestDeals() {
  // Gültigkeit („endet bald“) hängt vom aktuellen Zeitpunkt ab: zur Anfragezeit rendern, die Daten bleiben zwischengespeichert
  await connection();
  const deals = await getLatestDeals(4);
  if (!deals.length) {
    // Schmaler Hinweis statt großer Leerfläche, solange es noch keine Händlerangebote gibt
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-ink-900">Bald findest du hier Aktionen von Händlern.</span> Du bist Händler:in? Stelle deine Angebote kostenlos ein.
        </p>
        <Link href="/konto/deals" className={buttonClasses({ variant: 'outline', size: 'sm', className: 'shrink-0' })}>
          Angebot einstellen
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {deals.map((deal) => (
        <li key={deal.id} className="flex">
          <DealCard deal={deal} />
        </li>
      ))}
    </ul>
  );
}
