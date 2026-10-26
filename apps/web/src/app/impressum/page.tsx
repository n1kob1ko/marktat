import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Impressum' };

export default function ImprintPage() {
  return (
    <LegalPage title="Impressum">
      <p>Offenlegung gemäß § 25 Mediengesetz und Informationspflichten gemäß § 5 E-Commerce-Gesetz (ECG).</p>
      <h2>Medieninhaber und Betreiber</h2>
      <ul>
        <li>Firmenname: [noch festzulegen]</li>
        <li>Anschrift: [Straße, PLZ Ort, Österreich]</li>
        <li>Firmenbuchnummer / Firmenbuchgericht: [FN …, Handelsgericht …]</li>
        <li>UID-Nummer: [ATU…]</li>
        <li>Kontakt: [E-Mail], [Telefon]</li>
        <li>Aufsichtsbehörde / Kammerzugehörigkeit: [falls zutreffend]</li>
      </ul>
      <h2>Kontaktstelle nach dem Digital Services Act (Art. 11 und 12 DSA)</h2>
      <p>[E-Mail-Adresse für Behörden und Nutzer:innen, Sprachen: Deutsch, Englisch]</p>
    </LegalPage>
  );
}
