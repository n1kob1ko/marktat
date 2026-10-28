import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Werbung und Partnerangebote', alternates: { canonical: '/deals/werbung' } };

/** Offenlegung, wie Partnerangebote zustande kommen und gekennzeichnet sind (§ 6 ECG, § 26 MedienG, UWG) */
export default function DealsAdvertisingPage() {
  return (
    <LegalPage title="Werbung und Partnerangebote">
      <p>
        Im Bereich <Link href="/deals">Deals</Link> gibt es drei getrennte Arten von Angeboten. Woher ein Angebot stammt, steht immer direkt beim Angebot.
      </p>
      <h2>1. Angebote von Händlern auf MarktAT</h2>
      <p>
        Gewerbliche Händler mit einem MarktAT-Konto tragen ihre Angebote selbst ein oder liefern sie über ihren eigenen Produktfeed. Der Händler ist für Preis,
        Verfügbarkeit und Bilder verantwortlich und muss seine Angebote regelmäßig bestätigen.
      </p>
      <h2>2. Partnerangebote über Affiliate-Netzwerke</h2>
      <p>
        Angebote mit dem Hinweis <strong>„Werbung“</strong> und „Partnerangebot über Awin“ stammen aus den Produktfeeds von Händlern, mit denen MarktAT über das
        Partnernetzwerk Awin eine Partnerschaft hat. Diese Händler haben kein MarktAT-Händlerkonto; angezeigt werden ihr Name und die Quelle (Netzwerk und
        Datenstand des Feeds).
      </p>
      <ul>
        <li>Kauft jemand nach einem Klick auf ein Partnerangebot, erhält MarktAT eventuell eine Provision vom Netzwerk. Der Preis ändert sich dadurch nicht.</li>
        <li>Veröffentlicht werden nur Händler, deren Partnerschaft bestätigt ist und deren Programm wir einzeln freigegeben haben.</li>
        <li>Einen Rabatt zeigen wir nur, wenn der Händler im Feed einen Vergleichspreis liefert und das Programm das erlaubt. Ungewöhnlich hohe Rabatte prüfen wir vor der Veröffentlichung.</li>
        <li>Produktbilder zeigen wir nur unverändert und nur, wenn die Programmbedingungen das erlauben.</li>
        <li>Abgelaufene oder nicht mehr gelieferte Angebote werden automatisch ausgeblendet. Maßgeblich sind Preis und Bedingungen auf der Seite des Händlers.</li>
      </ul>
      <h2>3. Aktionen und Gutscheine</h2>
      <p>
        Aktionen und Gutscheincodes kommen ebenfalls aus freigegebenen Partnerprogrammen und sind als „Werbung“ gekennzeichnet. Sie gelten nur zu den Bedingungen des
        Händlers.
      </p>
      <h2>Was wir nicht tun</h2>
      <ul>
        <li>Wir übernehmen keine Angebote von Preisvergleichs- oder Prospektportalen.</li>
        <li>Wir ordnen Partnerangebote keinem MarktAT-Händlerkonto zu, das den Händler nicht vertritt.</li>
        <li>Die Reihenfolge der Angebote hängt nicht von der Höhe einer Provision ab.</li>
      </ul>
      <p>
        Ein Angebot wirkt falsch oder irreführend? Auf jeder Angebotsseite gibt es „Melden“ – das Team prüft die Meldung und blendet das Angebot bei Bedarf aus.
      </p>
    </LegalPage>
  );
}
