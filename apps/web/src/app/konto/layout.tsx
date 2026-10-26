import Link from 'next/link';
import { Container } from '@marktat/ui';

const NAV = [
  { href: '/konto', label: 'Profil' },
  { href: '/konto/anzeigen', label: 'Meine Anzeigen' },
];

export default function AccountLayout({ children }: LayoutProps<'/konto'>) {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Mein Konto</h1>
      <nav aria-label="Kontobereich" className="mt-6 flex gap-1 border-b border-line">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-ink-600 hover:border-line-strong hover:text-ink-900">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-8">{children}</div>
    </Container>
  );
}
