import Image from 'next/image';
import Link from 'next/link';
import { buttonClasses, Container } from '@marktat/ui';
import lostPhoto from '@/assets/bilder/fehlerseite-handschuh.jpg';

export default function NotFound() {
  return (
    <Container className="py-12 text-center sm:py-16">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-[var(--radius-card)]">
        <Image src={lostPhoto} alt="Ein verlorener roter Fäustling auf einem Parkzaun" fill sizes="24rem" placeholder="blur" className="object-cover" />
      </div>
      <p className="mt-8 font-display text-6xl font-bold text-brand-700">404</p>
      <h1 className="mt-4 text-2xl font-bold text-ink-950">Diese Seite gibt es nicht (mehr)</h1>
      <p className="mt-2 text-ink-600">Vielleicht wurde die Anzeige bereits verkauft oder gelöscht.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonClasses()}>Zur Startseite</Link>
        <Link href="/suche" className={buttonClasses({ variant: 'outline' })}>Anzeigen durchsuchen</Link>
      </div>
    </Container>
  );
}
