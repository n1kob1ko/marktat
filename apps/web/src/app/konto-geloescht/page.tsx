import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { buttonClasses, Container } from '@marktat/ui';

export const metadata: Metadata = { title: 'Konto gelöscht', robots: { index: false } };

export default function AccountDeletedPage() {
  return (
    <Container className="max-w-2xl py-16 text-center sm:py-20">
      <CircleCheck className="mx-auto size-12 text-success-700" aria-hidden="true" />
      <h1 className="mt-4 text-3xl font-bold text-ink-950">Dein Konto wird gelöscht</h1>
      <p className="mt-3 leading-relaxed text-ink-600">
        Du bist abgemeldet und kannst dich mit diesem Konto nicht mehr anmelden. Deine Anzeigen sind schon nicht mehr sichtbar; Bilder und übrige Daten entfernen wir in den nächsten
        Minuten automatisch. Danke, dass du MarktAT genutzt hast.
      </p>
      <Link href="/" className={buttonClasses({ className: 'mt-8' })}>
        Zur Startseite
      </Link>
    </Container>
  );
}
