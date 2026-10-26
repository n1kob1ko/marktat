# Rechtliches – Checkliste

> ⚠️ **Muss von einer österreichischen Rechtsanwältin bzw. einem österreichischen Rechtsanwalt geprüft werden.**
> Die Seiten Impressum, Datenschutz, AGB und Meldestelle im Frontend sind Platzhalter mit Struktur, keine Rechtstexte.
> Diese Liste ist eine technische Gedächtnisstütze und keine Rechtsberatung.

| Thema | Rechtsgrundlage (Stichwort) | Stand im Code |
| --- | --- | --- |
| Impressum / Offenlegung | ECG § 5, MedienG § 25, UGB § 14 | Seite `/impressum` mit Platzhaltern |
| Datenschutzerklärung | DSGVO Art. 13/14, DSG | Seite `/datenschutz` mit Platzhaltern |
| AGB / Nutzungsbedingungen | ABGB, KSchG | Seite `/agb` mit Platzhaltern; Zustimmung bei Registrierung mit Version und Zeitpunkt gespeichert |
| Melde- und Abhilfeverfahren | DSA Art. 16, 17, 20 | Seite `/melden` als Platzhalter; Melde-Funktion folgt in Phase 3 |
| Kennzeichnung gewerblicher Anbieter | DSA Art. 30 (Nachverfolgbarkeit), FAGG | Firmenname, Firmenbuchnummer, UID werden beim Händlerkonto erfasst; Prüfung der Angaben folgt |
| Kommunikationsplattformen | KoPl-G (prüfen, ob anwendbar) | offen |
| Cookies / Einwilligung | TKG 2021 § 165 | nur technisch notwendige Cookies (Sitzung); kein Tracking → derzeit kein Banner nötig, prüfen lassen |
| Auftragsverarbeitung | DSGVO Art. 28 | AV-Verträge mit Supabase, Cloudflare, Stripe, Hoster, ggf. OpenAI abschließen |
| Drittlandübermittlung | DSGVO Art. 44 ff. | EU-Regionen wählen; Data Privacy Framework der Anbieter prüfen |
| Verzeichnis der Verarbeitungstätigkeiten | DSGVO Art. 30 | offen |
| Löschfristen | DSGVO Art. 5, 17 | Soft-Delete vorhanden; Fristen und endgültige Löschung festlegen |
| Verbotene Inhalte / Kategorien | u. a. Waffen-, Arzneimittel-, Tierschutzrecht | Kategorienliste juristisch prüfen, Moderationsregeln ab Phase 3 |
| Jobs: Gleichbehandlung | GlBG § 9 (geschlechtsneutrale Ausschreibung), § 9 Abs. 2 (Gehaltsangabe) | Pflichtfeld Gehalt in Phase 5 |
| Immobilien: Energieausweis | EAVG § 3 (HWB/fGEE in Inseraten) | Pflichtfelder in Phase 5 |
| Bezahlte Leistungen | Preisangaben, Rechnungslegung, Rücktrittsrecht (FAGG) | Phase 4 |
| Quellenangabe Geodaten | CC BY 4.0 (GeoNames bzw. Statistik Austria) | Namensnennung bei Import des vollständigen Verzeichnisses ergänzen |
