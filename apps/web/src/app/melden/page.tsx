import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Inhalte melden' };

export default function ReportPage() {
  return (
    <LegalPage title="Inhalte melden">
      <p>
        Du hast eine betrügerische, rechtswidrige oder gegen unsere Regeln verstoßende Anzeige entdeckt? Das Meldeformular
        nach Art. 16 DSA (mit Begründung, Fundstelle und Bestätigung nach Treu und Glauben) wird in Phase 3 umgesetzt.
      </p>
      <p>Bis dahin: Meldungen bitte an [Kontakt-E-Mail des Betreibers] mit dem Link zur Anzeige.</p>
    </LegalPage>
  );
}
