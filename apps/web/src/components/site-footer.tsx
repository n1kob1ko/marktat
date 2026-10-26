import Link from 'next/link';
import { Container } from '@marktat/ui';
import { VERTICAL_LABELS, VERTICAL_SLUGS, VERTICALS } from '@marktat/shared';
import { Logo } from './logo';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-ink-500">
            Der Marktplatz für Österreich – kaufen, verkaufen, wohnen und arbeiten. Von Bregenz bis Neusiedl.
          </p>
        </div>
        <FooterColumn title="Bereiche">
          {VERTICALS.map((v) => (
            <FooterLink key={v} href={`/suche?bereich=${VERTICAL_SLUGS[v]}`}>
              {VERTICAL_LABELS[v]}
            </FooterLink>
          ))}
        </FooterColumn>
        <FooterColumn title="Mitmachen">
          <FooterLink href="/inserieren">Inserat aufgeben</FooterLink>
          <FooterLink href="/registrieren">Konto erstellen</FooterLink>
          <FooterLink href="/konto/anzeigen">Meine Anzeigen</FooterLink>
        </FooterColumn>
        <FooterColumn title="Rechtliches">
          <FooterLink href="/impressum">Impressum</FooterLink>
          <FooterLink href="/datenschutz">Datenschutz</FooterLink>
          <FooterLink href="/agb">Nutzungsbedingungen</FooterLink>
          <FooterLink href="/melden">Inhalte melden (DSA)</FooterLink>
        </FooterColumn>
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-5 text-xs text-ink-500 sm:flex-row sm:justify-between">
          <p>© 2026 MarktAT (Arbeitstitel). Alle Preise in Euro inkl. USt., sofern nicht anders angegeben.</p>
          <p>Gemacht in Österreich</p>
        </Container>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-sans text-sm font-semibold tracking-normal text-ink-900">{title}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-sm text-ink-600 hover:text-brand-700 hover:underline">
        {children}
      </Link>
    </li>
  );
}
