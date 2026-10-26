import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Datenschutzerklärung' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Datenschutzerklärung">
      <p>Informationen gemäß Art. 13 und 14 DSGVO. Die folgende Gliederung beschreibt die tatsächlich umgesetzten Verarbeitungen und ist zu vervollständigen.</p>
      <h2>Verantwortlicher</h2>
      <p>[Name und Kontaktdaten des Verantwortlichen, ggf. Datenschutzbeauftragte:r]</p>
      <h2>Verarbeitete Daten</h2>
      <ul>
        <li>Konto: E-Mail-Adresse, Passwort (nur als Hash bei Supabase Auth), Anzeigename, Kontoart, optional Telefon und Firmenangaben.</li>
        <li>Inserate: Inhalte, Preis, PLZ und Ort (keine genaue Adresse).</li>
        <li>Sicherheitsprotokoll: Ereignistyp, Zeitpunkt, gekürzte IP-Adresse (IPv4 /24, IPv6 /48).</li>
        <li>Technisch notwendige Cookies für die Anmeldung (Sitzungs-Cookies von Supabase Auth).</li>
      </ul>
      <h2>Auftragsverarbeiter</h2>
      <ul>
        <li>Supabase (Authentifizierung) – [Region und Vertragsgrundlage prüfen]</li>
        <li>Geplant: Cloudflare R2 (Bilder), Stripe (Zahlungen), E-Mail-Versanddienst, optional OpenAI (KI-Funktionen)</li>
      </ul>
      <h2>Ihre Rechte</h2>
      <p>Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Beschwerde bei der Österreichischen Datenschutzbehörde (dsb.gv.at).</p>
      <h2>Cookies</h2>
      <p>Derzeit werden ausschließlich technisch notwendige Cookies gesetzt; ein Einwilligungsbanner ist dafür nicht erforderlich. Vor Einführung von Analyse- oder Marketing-Diensten ist eine Einwilligungslösung umzusetzen.</p>
    </LegalPage>
  );
}
