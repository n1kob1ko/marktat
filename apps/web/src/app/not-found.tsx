import Link from 'next/link';
import { buttonClasses, Container } from '@marktat/ui';

export default function NotFound() {
  return (
    <Container className="py-20 text-center">
      <p className="font-display text-6xl font-bold text-brand-700">404</p>
      <h1 className="mt-4 text-2xl font-bold text-ink-950">Diese Seite gibt es nicht (mehr)</h1>
      <p className="mt-2 text-ink-600">Vielleicht wurde die Anzeige bereits verkauft oder gelöscht.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/" className={buttonClasses()}>Zur Startseite</Link>
        <Link href="/suche" className={buttonClasses({ variant: 'outline' })}>Anzeigen durchsuchen</Link>
      </div>
    </Container>
  );
}
