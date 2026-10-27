/**
 * Angaben zur Betreiberin bzw. zum Betreiber von MarktAT für Impressum, Datenschutzerklärung, Kontakt und
 * Nutzungsbedingungen. Öffentliche Pflichtangaben (ECG § 5, MedienG § 25, DSA Art. 11/12) – daher im Code.
 *
 * NUR echte, von Niko bestätigte Angaben eintragen. `null` = fehlt noch; die Seiten zeigen dann sichtbar
 * „Angabe fehlt noch“. Was gebraucht wird: docs/rechtliches.md, Abschnitt „Was Niko liefern muss“.
 */
export interface Operator {
  /** Name bzw. Firma laut Firmenbuch, bei Einzelpersonen der volle Name */
  name: string | null;
  /** z. B. Einzelunternehmen, GmbH, Verein */
  legalForm: string | null;
  /** Unternehmensgegenstand (MedienG § 25) */
  businessPurpose: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  /** E-Mail für allgemeine Anfragen (ECG § 5: rasche, unmittelbare Kontaktaufnahme) */
  email: string | null;
  phone: string | null;
  /** Firmenbuchnummer und -gericht, falls eingetragen */
  companyRegister: string | null;
  /** UID-Nummer, falls vorhanden */
  vatId: string | null;
  /** Kammer/Berufsverband und Aufsichtsbehörde, falls zutreffend (z. B. Gewerbebehörde) */
  supervisoryAuthority: string | null;
  /** Kontaktstelle nach DSA Art. 11 (Behörden) und Art. 12 (Nutzer:innen) */
  dsaContactEmail: string | null;
  /** Sprachen der DSA-Kontaktstelle */
  dsaLanguages: string | null;
  /** Kontakt für Datenschutzanfragen (falls abweichend von email) */
  privacyEmail: string | null;
  /** Datenschutzbeauftragte:r, nur falls bestellt */
  dataProtectionOfficer: string | null;
  /** Grundlegende Richtung des Mediums (MedienG § 25 Abs. 4), für eine Kleinanzeigenplattform meist kurz */
  editorialLine: string | null;
}

export const OPERATOR: Operator = {
  name: null,
  legalForm: null,
  businessPurpose: null,
  street: null,
  postalCode: null,
  city: null,
  country: null,
  email: null,
  phone: null,
  companyRegister: null,
  vatId: null,
  supervisoryAuthority: null,
  dsaContactEmail: null,
  dsaLanguages: null,
  privacyEmail: null,
  dataProtectionOfficer: null,
  editorialLine: null,
};

/**
 * Dienstleister, die im Online-Betrieb personenbezogene Daten verarbeiten (für die Datenschutzerklärung).
 * `provider: null` = noch nicht gewählt bzw. kein Vertrag; Region und Vertragsgrundlage erst nach Abschluss eintragen.
 */
export interface Processor {
  purpose: string;
  provider: string | null;
  region: string | null;
}

export const PROCESSORS: Processor[] = [
  { purpose: 'Server und Datenbank (Hosting)', provider: null, region: null },
  { purpose: 'Bilder (Speicher)', provider: 'Cloudflare R2', region: null },
  { purpose: 'E-Mail-Versand', provider: null, region: null },
];

/** Pflichtangaben, die vor dem öffentlichen Start feststehen müssen (für Hinweise und Tests) */
export const REQUIRED_OPERATOR_FIELDS = ['name', 'street', 'postalCode', 'city', 'email', 'dsaContactEmail'] as const;

export function missingOperatorFields(operator: Operator = OPERATOR): string[] {
  return REQUIRED_OPERATOR_FIELDS.filter((field) => !operator[field]?.trim());
}
