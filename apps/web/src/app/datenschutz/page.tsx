import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Fact, LegalFact, Missing } from '@/components/legal-fact';
import { LegalPage } from '@/components/legal-page';
import { AI_PROCESSOR, OPERATOR, PROCESSORS } from '@/content/operator';
import { getAutofillStatus } from '@/lib/autofill';

export const metadata: Metadata = { title: 'Datenschutzerklärung' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Datenschutzerklärung">
      <p>
        Informationen gemäß Art. 13 und 14 DSGVO. Die Gliederung beschreibt die tatsächlich umgesetzten Verarbeitungen
        und ist zu vervollständigen.
      </p>
      <h2>Verantwortlicher</h2>
      <ul>
        <LegalFact label="Name bzw. Firma" value={OPERATOR.name} />
        <LegalFact label="Anschrift" value={OPERATOR.street && OPERATOR.city ? `${OPERATOR.street}, ${OPERATOR.postalCode ?? ''} ${OPERATOR.city}` : null} />
        <LegalFact label="E-Mail für Datenschutzanfragen" value={OPERATOR.privacyEmail ?? OPERATOR.email} />
        {OPERATOR.dataProtectionOfficer ? <LegalFact label="Datenschutzbeauftragte:r" value={OPERATOR.dataProtectionOfficer} /> : null}
      </ul>
      <h2>Verarbeitete Daten</h2>
      <ul>
        <li>Konto: E-Mail-Adresse, Passwort (nur als Hash), Anzeigename, Kontoart, optional Telefon und Firmenangaben.</li>
        <li>Inserate: Inhalte, Bilder (ohne Standortdaten aus der Kamera), Preis, PLZ und Ort (keine genaue Adresse).</li>
        <li>Nachrichten zwischen Nutzer:innen, Merkliste, gespeicherte Suchen und Benachrichtigungen.</li>
        <li>Sicherheitsprotokoll: Ereignistyp, Zeitpunkt, gekürzte IP-Adresse (IPv4 /24, IPv6 /48).</li>
        <li>Server-Protokolle des Reverse-Proxys (Zeitpunkt, aufgerufene Adresse, IP-Adresse), Zweck: Betrieb und Abwehr von Angriffen.</li>
        <li>Technisch notwendige Cookies für die Anmeldung (Sitzungs-Cookies).</li>
      </ul>
      <h2>Wo die Daten liegen</h2>
      <p>
        Konten (Anmeldung über Supabase Auth, selbst betrieben), Inserate und Nachrichten liegen in der eigenen Datenbank
        auf dem Server von Markterl; es gibt kein Konto bei Supabase. Bilder liegen bei Cloudflare R2.
      </p>
      <h2>Auftragsverarbeiter</h2>
      <Suspense fallback={<ProcessorList processors={PROCESSORS} />}>
        <CurrentProcessors />
      </Suspense>
      <p>Zahlungsdienste sind nicht aktiv; es werden keine Daten an Stripe übermittelt.</p>
      <h2 id="foto-assistent">Foto-Assistent beim Inserieren</h2>
      <Suspense fallback={<p className="text-ink-500">Wird geladen …</p>}>
        <CurrentPhotoAssistantText />
      </Suspense>
      <h2>Speicherdauer</h2>
      <ul>
        <li>Konto und Inserate: bis zur Löschung des Kontos (jederzeit unter <Link href="/konto/datenschutz">Konto › Datenschutz</Link>).</li>
        <li>Mitteilungen, Sicherheitsprotokoll, Meldungen und Moderationsentscheidungen: Fristen sind technisch umgesetzt und werden rechtlich bestätigt (<Missing />).</li>
        <li>Datensicherungen: verschlüsselt, Aufbewahrung <Missing />.</li>
        <li>Server-Protokolle: werden nach Größe rotiert, Höchstdauer <Missing />.</li>
      </ul>
      <h2>Ihre Rechte</h2>
      <p>
        Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Beschwerde bei der
        Österreichischen Datenschutzbehörde (dsb.gv.at). Datenexport und Kontolöschung direkt unter{' '}
        <Link href="/konto/datenschutz">Konto › Datenschutz</Link>.
      </p>
      <h2>Cookies</h2>
      <p>
        Derzeit werden ausschließlich technisch notwendige Cookies gesetzt; ein Einwilligungsbanner ist dafür nicht
        erforderlich. Vor Einführung von Analyse- oder Marketing-Diensten ist eine Einwilligungslösung umzusetzen.
      </p>
      <h2>Partnerangebote (Affiliate-Links)</h2>
      <p>
        Mit „Werbung“ gekennzeichnete Partnerangebote führen über einen Tracking-Link des Partnernetzwerks (derzeit Awin)
        zum Händler. Erst beim Klick auf einen solchen Link setzen Awin bzw. der Händler auf ihren eigenen Seiten Cookies,
        um einen Kauf zuordnen zu können; dafür sind sie selbst verantwortlich. Produktbilder der Partnerangebote laden
        wir über unseren Server, damit beim bloßen Ansehen keine Daten an Händler oder Netzwerk gehen. Näheres unter{' '}
        <Link href="/deals/werbung">Werbung und Partnerangebote</Link>.
      </p>
    </LegalPage>
  );
}

/** Ob der Foto-Assistent (Anthropic) läuft, entscheidet die API – nach dem Ausschalten verschwindet er hier wieder */
async function CurrentProcessors() {
  const { enabled } = await getAutofillStatus();
  return <ProcessorList processors={enabled ? [...PROCESSORS, AI_PROCESSOR] : PROCESSORS} />;
}

function ProcessorList({ processors }: { processors: typeof PROCESSORS }) {
  return (
    <ul>
      {processors.map((p) => (
        <li key={p.purpose}>
          {p.purpose}: {p.provider ?? <Missing />}
          {p.provider ? (
            <>
              {' '}– Region: <Fact value={p.region} />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

async function CurrentPhotoAssistantText() {
  const { enabled } = await getAutofillStatus();
  return <PhotoAssistantText enabled={enabled} />;
}

function PhotoAssistantText({ enabled }: { enabled: boolean }) {
  if (!enabled) return <p>Der Foto-Assistent ist derzeit nicht aktiv; es werden keine Fotos an KI-Dienste übermittelt.</p>;
  return (
    <p>
      Wenn du beim Inserieren „Mit KI ausfüllen“ drückst, schicken wir bis zu vier deiner Fotos verkleinert und ohne Standort-
      und andere Metadaten an {AI_PROCESSOR.provider} ({AI_PROCESSOR.region}). Dessen KI-Modell Claude erstellt daraus
      Vorschläge für Kategorie, Titel, Beschreibung und Details, die du vor dem Veröffentlichen prüfst und änderst. Zweck ist,
      dir das Inserieren zu erleichtern; Rechtsgrundlage ist deine Anfrage (Art. 6 Abs. 1 lit. b DSGVO). Für die Auswertung
      speichern wir die Fotos nicht – Teil deiner Anzeige werden sie, weil du sie dort als Bilder hinzugefügt hast, und du
      kannst sie jederzeit entfernen. Anthropic verarbeitet die Fotos als Auftragsverarbeiter, verwendet sie nicht zum
      Training seiner Modelle und speichert sie nur für eine begrenzte Zeit. Die Übermittlung in die USA erfolgt auf Grundlage von Standardvertragsklauseln
      (Art. 46 DSGVO). Der Assistent ist freiwillig; du kannst alle Angaben auch selbst eintragen.
    </p>
  );
}
