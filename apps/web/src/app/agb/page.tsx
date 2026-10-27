import type { Metadata } from 'next';
import { Fact } from '@/components/legal-fact';
import { LegalPage } from '@/components/legal-page';
import { OPERATOR } from '@/content/operator';

export const metadata: Metadata = { title: 'Nutzungsbedingungen' };

export default function TermsPage() {
  return (
    <LegalPage title="Nutzungsbedingungen">
      <p>Version: 2026-10-entwurf. Bei der Registrierung wird diese Version gespeichert.</p>
      <p>
        Vertragspartner: <Fact value={OPERATOR.name} />. Während der Beta-Phase sind alle Leistungen kostenlos.
      </p>
      <h2>Zu regeln (Gliederung)</h2>
      <ul>
        <li>Vertragspartner, Geltungsbereich, Mindestalter</li>
        <li>Rolle der Plattform als Vermittler (Kaufverträge kommen zwischen Nutzer:innen zustande)</li>
        <li>Pflichten privater und gewerblicher Anbieter, Kennzeichnung gewerblicher Angebote</li>
        <li>Verbotene Inhalte und Waren, Moderation, Melde- und Beschwerdeverfahren nach DSA (Art. 16, 17, 20)</li>
        <li>Kostenpflichtige Leistungen, Preise, Zahlung über Stripe, Rücktrittsrecht nach FAGG</li>
        <li>Laufzeit von Anzeigen, Sperre und Kündigung von Konten</li>
        <li>Haftung, anwendbares Recht, Gerichtsstand, Streitbeilegung</li>
      </ul>
    </LegalPage>
  );
}
