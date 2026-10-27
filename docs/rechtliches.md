# Rechtliches – Checkliste

> ⚠️ **Muss von einer österreichischen Rechtsanwältin bzw. einem österreichischen Rechtsanwalt geprüft werden.**
> Die Seiten Impressum, Datenschutz, AGB und Meldestelle im Frontend sind Platzhalter mit Struktur, keine Rechtstexte.
> Diese Liste ist eine technische Gedächtnisstütze und keine Rechtsberatung.
> Stand Phase 8 (27.10.2026): kein öffentlicher Start, keine echten Zahlungen, Suchmaschinen gesperrt.

## Vor dem öffentlichen Start zu erledigen

- [ ] Impressum mit echten Angaben (Betreiber, Anschrift, Kontakt, ggf. UID/Firmenbuch) – Platzhalter ersetzen
- [ ] Datenschutzerklärung vollständig (Verarbeitungen, Empfänger, Fristen, Rechte, Kontakt) – Platzhalter ersetzen
- [ ] AGB / Nutzungsbedingungen inkl. Liste verbotener Artikel – Platzhalter ersetzen, neue Version setzen (`TERMS_VERSION`)
- [ ] Löschfristen bestätigen bzw. festlegen (offene Fragen in [datenschutz.md](datenschutz.md#prüfung-vor-dem-start-phase-8))
- [ ] AV-Verträge: Hoster, Supabase, Cloudflare (R2), E-Mail-Versand, Stripe (erst bei echten Zahlungen), ggf. Monitoring
- [ ] Drittlandübermittlung je Anbieter prüfen (EU-Regionen gewählt?)
- [ ] Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO)
- [ ] DSA: Kontaktstelle (Art. 11/12), Transparenzbericht, ggf. Transparenzdatenbank; Meldungen ohne Konto (Art. 16)?
- [ ] KoPl-G: Anwendbarkeit klären
- [ ] Cookie-Hinweis: nur technisch notwendige Cookies – Bestätigung, dass kein Banner nötig ist
- [ ] Aufbewahrung von Sicherungen (Dauer, Ort, Löschung) festlegen
- [ ] Monitoring-Dienst (falls gewünscht): Freigabe, AV-Vertrag, EU-Region
- [ ] Vor echten Zahlungen: Preisangaben, Rechnungen, Rücktrittsrecht/Widerruf (FAGG), Steuern – derzeit alles kostenlos

## Übersicht

| Thema | Rechtsgrundlage (Stichwort) | Stand im Code |
| --- | --- | --- |
| Impressum / Offenlegung | ECG § 5, MedienG § 25, UGB § 14 | Seite `/impressum` mit Platzhaltern |
| Datenschutzerklärung | DSGVO Art. 13/14, DSG | Seite `/datenschutz` mit Platzhaltern |
| AGB / Nutzungsbedingungen | ABGB, KSchG | Seite `/agb` mit Platzhaltern; Zustimmung bei Registrierung mit Version und Zeitpunkt gespeichert |
| Melde- und Abhilfeverfahren | DSA Art. 16, 17, 20, 21, 23 | Phase 6: Meldeformular mit Begründung und Erklärung nach Treu und Glauben, Begründung jeder Entscheidung an Betroffene, Einspruch binnen 6 Monaten, Hinweis auf Streitbeilegung, Umgang mit missbräuchlichen Meldungen. Offene Prüfpunkte in [moderation.md](moderation.md#offene-punkte-für-die-rechtsprüfung) |
| Kennzeichnung gewerblicher Anbieter | DSA Art. 30 (Nachverfolgbarkeit), FAGG | Firmenname, Firmenbuchnummer, UID werden beim Händlerkonto erfasst; Prüfung der Angaben folgt |
| Kommunikationsplattformen | KoPl-G (prüfen, ob anwendbar) | offen |
| Cookies / Einwilligung | TKG 2021 § 165 | nur technisch notwendige Cookies (Sitzung); kein Tracking → derzeit kein Banner nötig, prüfen lassen |
| Auftragsverarbeitung | DSGVO Art. 28 | AV-Verträge mit Supabase, Cloudflare, Stripe, Hoster, ggf. OpenAI abschließen |
| Drittlandübermittlung | DSGVO Art. 44 ff. | EU-Regionen wählen; Data Privacy Framework der Anbieter prüfen |
| Verzeichnis der Verarbeitungstätigkeiten | DSGVO Art. 30 | offen |
| Löschfristen | DSGVO Art. 5, 17 | Phase 6: Kontolöschung, täglicher Aufbewahrungsjob mit vorgeschlagenen Fristen ([datenschutz.md](datenschutz.md)); Fristen rechtlich bestätigen, endgültige Löschung soft-gelöschter Inserate offen |
| Auskunft / Datenübertragbarkeit | DSGVO Art. 15, 20 | Phase 6: JSON-Export im Konto (ohne Bilddateien) |
| Transparenzpflichten | DSA Art. 15, 24 (ggf. Ausnahme Art. 19) | offen: Transparenzbericht, Übermittlung an die DSA-Transparenzdatenbank prüfen |
| Verbotene Inhalte / Kategorien | u. a. Waffen-, Arzneimittel-, Tierschutzrecht | Meldegrund „Verbotener Artikel“ und Moderation vorhanden (Phase 6); Liste verbotener Artikel in den AGB festlegen und prüfen |
| Jobs: Gleichbehandlung | GlBG § 9 (geschlechtsneutrale Ausschreibung), § 9 Abs. 2 (Gehaltsangabe) | Pflichtfeld Gehalt in Phase 5 |
| Immobilien: Energieausweis | EAVG § 3 (HWB/fGEE in Inseraten) | Pflichtfelder in Phase 5 |
| Bezahlte Leistungen | Preisangaben, Rechnungslegung, Rücktrittsrecht (FAGG) | Phase 7: vorbereitet, Betrieb kostenlos, Stripe nur Testmodus ([monetarisierung.md](monetarisierung.md)) |
| Quellenangabe Geodaten | CC BY 4.0 (GeoNames) | Namensnennung im Impressum unter „Datenquellen“ |
| Zwei-Faktor-Anmeldung für das Team | DSGVO Art. 32 (Sicherheit der Verarbeitung) | Phase 8: TOTP für Admin und Moderation, Pflicht in Produktion; Protokollierung von Einrichtung und Zurücksetzen |
| Sicherungen | DSGVO Art. 32 Abs. 1 lit. c (Wiederherstellbarkeit) | Phase 8: lokale Sicherungs-/Wiederherstellungsroutine mit Probelauf ([betrieb.md](betrieb.md)); Livebetrieb offen |
| Suchmaschinen / Sichtbarkeit | – | Phase 8: bis zum Start `noindex`; private Bereiche immer `noindex` |
| Staging | – | Phase 8: nur Konzept ([staging.md](staging.md)), nur synthetische Daten vorgesehen |
