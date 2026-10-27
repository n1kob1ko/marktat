import type { Metadata } from 'next';
import Link from 'next/link';
import { Fact, LegalFact } from '@/components/legal-fact';
import { LegalPage } from '@/components/legal-page';
import { OPERATOR } from '@/content/operator';

export const metadata: Metadata = { title: 'Impressum' };

const address = [OPERATOR.street, [OPERATOR.postalCode, OPERATOR.city].filter(Boolean).join(' '), OPERATOR.country]
  .filter(Boolean)
  .join(', ');

export default function ImprintPage() {
  return (
    <LegalPage title="Impressum">
      <p>Offenlegung gemäß § 25 Mediengesetz und Informationspflichten gemäß § 5 E-Commerce-Gesetz (ECG).</p>
      <h2>Medieninhaber und Betreiber</h2>
      <ul>
        <LegalFact label="Name bzw. Firma" value={OPERATOR.name} />
        <LegalFact label="Rechtsform" value={OPERATOR.legalForm} />
        <LegalFact label="Anschrift" value={OPERATOR.street && OPERATOR.city ? address : null} />
        <LegalFact label="E-Mail" value={OPERATOR.email}>
          <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </LegalFact>
        <LegalFact label="Telefon" value={OPERATOR.phone} />
        <LegalFact label="Unternehmensgegenstand" value={OPERATOR.businessPurpose} />
        <LegalFact label="Firmenbuchnummer und -gericht" value={OPERATOR.companyRegister} />
        <LegalFact label="UID-Nummer" value={OPERATOR.vatId} />
        <LegalFact label="Aufsichtsbehörde, Kammer" value={OPERATOR.supervisoryAuthority} />
      </ul>
      <p className="text-sm text-ink-500">
        Firmenbuch, UID und Aufsichtsbehörde nur, soweit sie für die Betreiberin bzw. den Betreiber zutreffen.
      </p>
      <h2>Grundlegende Richtung</h2>
      <p>
        <Fact value={OPERATOR.editorialLine} />
      </p>
      <h2>Kontaktstelle nach dem Digital Services Act (Art. 11 und 12 DSA)</h2>
      <p>
        Für Behörden, die Europäische Kommission und Nutzer:innen: <Fact value={OPERATOR.dsaContactEmail} />
        {OPERATOR.dsaLanguages ? ` (Sprachen: ${OPERATOR.dsaLanguages})` : null}. Rechtswidrige Inhalte bitte über{' '}
        <Link href="/melden">Inhalte melden</Link> mitteilen.
      </p>
      <h2>Beta-Phase</h2>
      <p>MarktAT befindet sich in einer öffentlichen Testphase. Alle Leistungen sind derzeit kostenlos.</p>
      <h2>Datenquellen</h2>
      <p>
        Postleitzahlen und Orte: <a href="https://www.geonames.org/">GeoNames</a>, Lizenz{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/deed.de">CC BY 4.0</a>, für MarktAT aufbereitet.
      </p>
    </LegalPage>
  );
}
