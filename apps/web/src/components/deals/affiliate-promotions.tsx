import Link from 'next/link';
import { ExternalLink, Ticket } from 'lucide-react';
import { formatDate, type AffiliatePromotionView } from '@marktat/shared';
import { AdLabel } from './ad-label';

/**
 * Aktionen und Gutscheine aus freigegebenen Partnerprogrammen. Deutlich als Werbung gekennzeichnet, mit Händler
 * und Netzwerk als Quelle; Links gehen direkt zum Tracking-Link des Netzwerks (rel="sponsored").
 */
export function AffiliatePromotions({ promotions }: { promotions: AffiliatePromotionView[] }) {
  if (!promotions.length) return null;
  return (
    <section aria-labelledby="promotions-heading" className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="promotions-heading" className="text-lg font-bold text-ink-950">Aktionen & Gutscheine</h2>
        <AdLabel />
        <Link href="/deals/werbung" className="text-xs font-semibold text-brand-700 hover:underline">Warum Werbung?</Link>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {promotions.map((promotion) => (
          <li key={promotion.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-card)]">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <Ticket className="size-3.5" aria-hidden="true" />
              {promotion.advertiserName}
              <span className="font-normal text-ink-500">· {promotion.type === 'VOUCHER' ? 'Gutschein' : 'Aktion'}</span>
            </p>
            <h3 className="font-sans text-[0.9375rem] leading-snug font-semibold tracking-normal [overflow-wrap:anywhere] text-ink-900">{promotion.title}</h3>
            {promotion.description && promotion.description !== promotion.title ? <p className="line-clamp-3 text-ink-600">{promotion.description}</p> : null}
            {promotion.voucherCode ? (
              <p className="text-ink-700">
                Code: <span className="rounded border border-dashed border-line-strong bg-canvas px-1.5 py-0.5 font-mono font-semibold select-all">{promotion.voucherCode}</span>
              </p>
            ) : null}
            {promotion.terms ? <p className="line-clamp-2 text-xs text-ink-500">Bedingungen: {promotion.terms}</p> : null}
            <p className="mt-auto text-xs text-ink-500">
              {promotion.endsAt ? `Gültig bis ${formatDate(promotion.endsAt)}` : 'Gültig solange beim Händler verfügbar'} · Quelle: {promotion.networkName}
            </p>
            <a
              href={promotion.url}
              target="_blank"
              rel="sponsored nofollow noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
            >
              Zur Aktion bei {promotion.advertiserName}
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(öffnet die Seite des Händlers in einem neuen Tab, Werbelink)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
