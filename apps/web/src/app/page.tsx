import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowRight, Briefcase, Car, Camera, House, MessageCircle, ShieldCheck, ShoppingBag, Store, Tag } from 'lucide-react';
import { buttonClasses, Container, Skeleton } from '@marktat/ui';
import { VERTICAL_SLUGS } from '@marktat/shared';
import { SearchHero } from '@/components/search-hero';
import { TopoPattern } from '@/components/topo-pattern';
import { ListingCard } from '@/components/listing-card';
import { CategoryIcon } from '@/components/category-icon';
import { getCategories, getLatestDeals, getLatestListings } from '@/lib/data';
import { DealCard } from '@/components/deals/deal-card';
import { getPublicBilling } from '@/lib/billing';
import { IntroBanner } from '@/components/billing/intro-banner';

const VERTICAL_TILES = [
  { slug: VERTICAL_SLUGS.MARKETPLACE, title: 'Marktplatz', text: 'Elektronik, Möbel, Mode und mehr', icon: ShoppingBag, tone: 'bg-brand-50 text-brand-700' },
  { slug: VERTICAL_SLUGS.VEHICLES, title: 'Auto & Motor', text: 'Gebrauchtwagen, Motorräder, Zubehör', icon: Car, tone: 'bg-accent-50 text-accent-700' },
  { slug: VERTICAL_SLUGS.REAL_ESTATE, title: 'Immobilien', text: 'Wohnungen und Häuser mieten & kaufen', icon: House, tone: 'bg-[#eef2fb] text-[#2f4a8a]' },
  { slug: VERTICAL_SLUGS.JOBS, title: 'Jobs', text: 'Vollzeit, Teilzeit, Lehrstellen', icon: Briefcase, tone: 'bg-[#f6eefb] text-[#6b3a8a]' },
];

export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-brand-800 text-white">
        <TopoPattern className="absolute inset-0 -z-10 size-full text-white/[0.07]" />
        <div aria-hidden="true" className="absolute -top-40 -right-40 -z-10 size-[32rem] rounded-full bg-accent-500/15 blur-3xl" />
        <Container className="py-14 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-brand-100">
              <span className="size-1.5 rounded-full bg-accent-500" aria-hidden="true" />
              Kleinanzeigen aus allen neun Bundesländern
            </p>
            <h1 className="mt-5 text-4xl leading-[1.05] font-bold sm:text-5xl lg:text-6xl">
              Gutes findet man <span className="text-accent-300">um die Ecke.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-brand-100">
              Kostenlos inserieren, in der Nähe finden, fair handeln – vom Fahrrad bis zur Wohnung.
            </p>
          </div>
          <div className="mt-9 max-w-4xl">
            <SearchHero />
          </div>
        </Container>
      </section>

      <Container className="-mt-8 relative z-10">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {VERTICAL_TILES.map((tile) => (
            <li key={tile.slug}>
              <Link
                href={`/suche?bereich=${tile.slug}`}
                className="group flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] sm:flex-row sm:items-center sm:p-5"
              >
                <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tile.tone}`}>
                  <tile.icon className="size-5.5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold text-ink-900">{tile.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-500">{tile.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      <Container className="mt-16">
        <SectionHeading title="Kategorien im Marktplatz" />
        <Suspense fallback={<GridSkeleton count={9} className="h-24" />}>
          <MarketplaceCategories />
        </Suspense>
      </Container>

      <Container className="mt-16">
        <SectionHeading
          title="Neu eingestellt"
          action={
            <Link href="/suche" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
              Alle Anzeigen <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
        <Suspense fallback={<GridSkeleton count={8} className="h-72" />}>
          <LatestListings />
        </Suspense>
      </Container>

      <Container className="mt-16">
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
                  <span className="flex size-10 items-center justify-center rounded-full bg-brand-700 font-display text-lg font-bold text-white">
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
            <div className="rounded-[var(--radius-card)] bg-brand-900 p-6 text-white sm:p-8">
              <Store className="size-7 text-accent-300" aria-hidden="true" />
              <h2 className="mt-3 font-sans text-lg font-semibold tracking-normal">Für Händler & Unternehmen</h2>
              <p className="mt-2 text-sm leading-relaxed text-brand-100">
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

async function MarketplaceCategories() {
  const categories = (await getCategories()).filter((c) => c.vertical === 'MARKETPLACE');
  if (!categories.length) {
    return <p className="text-ink-500">Kategorien sind gerade nicht verfügbar.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            href={`/suche?kategorie=${category.path}`}
            className="flex h-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3.5 sm:px-4 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <CategoryIcon name={category.icon} className="size-5 shrink-0 text-brand-700" />
            <span className="min-w-0 text-sm font-semibold break-words hyphens-auto text-ink-900">{category.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function LatestListings() {
  const listings = await getLatestListings(8);
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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
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
  const deals = await getLatestDeals(4);
  if (!deals.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
        <p className="font-semibold text-ink-900">Hier erscheinen bald Angebote von Händlern</p>
        <p className="mt-1 text-sm text-ink-500">Du bist Händler:in? Stelle deine Aktionen kostenlos ein – online oder für deine Filialen.</p>
        <Link href="/konto/deals" className={buttonClasses({ variant: 'outline', className: 'mt-5' })}>
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
