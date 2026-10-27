import type { Metadata } from 'next';
import Link from 'next/link';
import { Fact } from '@/components/legal-fact';
import { LegalPage } from '@/components/legal-page';
import { OPERATOR } from '@/content/operator';

export const metadata: Metadata = { title: 'Kontakt' };

export default function ContactPage() {
  return (
    <LegalPage title="Kontakt">
      <h2>Allgemeine Anfragen</h2>
      <p>
        E-Mail: <Fact value={OPERATOR.email} />
        {OPERATOR.phone ? `, Telefon: ${OPERATOR.phone}` : null}
      </p>
      <h2>Rechtswidrige Inhalte und Verstöße</h2>
      <p>
        Bitte direkt über <Link href="/melden">Inhalte melden</Link> oder den Link „Melden“ bei der Anzeige – so landet
        die Meldung mit allen nötigen Angaben bei der Moderation. Kontaktstelle nach dem DSA:{' '}
        <Fact value={OPERATOR.dsaContactEmail} />
      </p>
      <h2>Datenschutz</h2>
      <p>
        Auskunft, Datenexport und Kontolöschung gehen direkt unter <Link href="/konto/datenschutz">Konto › Datenschutz</Link>
        . Weitere Anfragen: <Fact value={OPERATOR.privacyEmail ?? OPERATOR.email} />
      </p>
      <h2>Fragen zu einer Anzeige</h2>
      <p>Bitte über „Nachricht schreiben“ in der Anzeige an die Anbieterin bzw. den Anbieter – MarktAT vermittelt nur.</p>
    </LegalPage>
  );
}
