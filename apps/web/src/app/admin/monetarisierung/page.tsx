import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, Badge, buttonClasses, Card, Skeleton } from '@marktat/ui';
import {
  BILLING_MODE_LABELS,
  PRICE_REASON_LABELS,
  formatAmountCents,
  formatDateTime,
  type BillingOverview,
  type ProductDto,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { PageTitle, StatCard } from '@/components/admin/admin-ui';
import { BillingModeForm, IntroSettingsForm, ProductForm } from '@/components/admin/billing-forms';
import { IntroBanner } from '@/components/billing/intro-banner';

export const metadata: Metadata = { title: 'Monetarisierung' };

export default function MonetizationPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Monetization />
    </Suspense>
  );
}

async function Monetization() {
  const { user, token } = await requireStaff('/admin/monetarisierung');
  if (user.role !== 'ADMIN') notFound();
  const overview = await api<BillingOverview>('/admin/billing', { token, cache: 'no-store' });
  const { settings, stripe, paidModeBlockers: blockers, counts } = overview;
  const paid = settings.billingMode === 'PAID';

  return (
    <div className="space-y-8">
      <PageTitle
        title="Monetarisierung"
        description="Preise, Einführungsaktion, Zusatzleistungen und Betriebsmodus. Jede Änderung wird protokolliert und gilt nur für neue Buchungen."
        actions={
          <Link href="/admin/monetarisierung/buchungen" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Buchungen ansehen
          </Link>
        }
      />

      <Block title="Betriebsmodus">
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={paid ? 'warning' : 'success'} className="text-sm">
              {BILLING_MODE_LABELS[settings.billingMode]}
            </Badge>
            {settings.billingModeChangedAt ? <span className="text-sm text-ink-500">seit {formatDateTime(settings.billingModeChangedAt)}</span> : null}
          </div>
          {paid ? (
            <Alert tone="warning">
              Freigegebene Leistungen mit Preis werden über Stripe ({stripe.keyMode === 'live' ? 'Live-Modus' : 'Testmodus'}) verrechnet. Bereits gebuchte Leistungen
              behalten ihren Preis.
            </Alert>
          ) : (
            <Alert tone="success">
              Alles ist kostenlos: Es werden keine Zahlungen gestartet und keine Zahlungsdaten erfasst. Geplante Preise und Aktionsenden schalten nichts automatisch um.
            </Alert>
          )}
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-500">Stripe-Schlüssel</dt>
            <dd>{stripe.keyMode === 'test' ? 'Testmodus' : stripe.keyMode === 'live' ? (stripe.liveEnabled ? 'Live (freigegeben)' : 'Live (gesperrt)') : 'nicht eingerichtet'}</dd>
            <dt className="text-ink-500">Webhook-Secret</dt>
            <dd>{stripe.webhookConfigured ? 'eingerichtet' : 'fehlt'}</dd>
          </dl>
          {blockers.length && !paid ? (
            <div className="rounded-xl bg-canvas p-4 text-sm">
              <p className="font-semibold text-ink-900">Der kostenpflichtige Betrieb ist derzeit nicht möglich:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-700">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <BillingModeForm mode={settings.billingMode} blocked={blockers.length > 0} />
        </Card>
      </Block>

      <Block title="Zahlen">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Laufende Leistungen" value={counts.activeBookings} />
          <StatCard label="Buchungen (30 Tage)" value={counts.bookings30d} href="/admin/monetarisierung/buchungen" />
          <StatCard label="Bezahlte Buchungen" value={counts.paidBookings} href="/admin/monetarisierung/buchungen?price=paid" />
          <StatCard label="Umsatz (bezahlt, abzügl. Erstattungen)" value={formatAmountCents(counts.revenueCents)} />
        </div>
      </Block>

      <Block title="Leistungen und Preise">
        <div className="grid gap-4">
          {overview.products.map((product) => (
            <Card key={product.code} className="p-5 sm:p-6">
              <ProductHeader product={product} />
              <div className="mt-5">
                <ProductForm product={product} />
              </div>
            </Card>
          ))}
        </div>
      </Block>

      <Block title="Einführungsaktion">
        <Card className="space-y-5 p-5 sm:p-6">
          {overview.intro ? (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Vorschau (so sieht es auf der Website aus)</p>
              <IntroBanner intro={overview.intro} />
            </div>
          ) : (
            <p className="text-sm text-ink-600">Die Einführungsaktion wird derzeit nicht angezeigt (ausgeschaltet, unsichtbar, außerhalb des Zeitraums oder Inserieren kostet etwas).</p>
          )}
          <IntroSettingsForm settings={settings} />
        </Card>
      </Block>

      <Block title="Zahlungen">
        <Card className="p-5 text-sm text-ink-600">
          {counts.paidBookings
            ? 'Bezahlte Buchungen mit Zahlungsstatus findest du unter „Buchungen ansehen“ (Filter „bezahlt“). Belege und Rechnungsnummern werden dort angezeigt, sobald Stripe sie liefert.'
            : 'Noch keine Zahlungen. Solange der kostenlose Betrieb aktiv ist, entstehen keine.'}
        </Card>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-sans text-base font-semibold tracking-normal text-ink-950">{title}</h3>
      {children}
    </section>
  );
}

function ProductHeader({ product }: { product: ProductDto }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">{product.name}</h3>
        <p className="text-xs text-ink-500">Zuletzt geändert {formatDateTime(product.updatedAt)}</p>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold text-ink-950 tabular-nums">{formatAmountCents(product.effective.priceCents)}</p>
        <p className="text-xs text-ink-500">Aktuell gültig · {PRICE_REASON_LABELS[product.effective.reason]}</p>
        {!product.isActive ? <Badge className="mt-1">nicht buchbar</Badge> : null}
      </div>
    </div>
  );
}
