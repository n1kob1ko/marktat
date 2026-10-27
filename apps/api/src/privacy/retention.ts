/**
 * Löschfristen (Datenminimierung, Art. 5 Abs. 1 lit. c und e DSGVO). Begründung je Frist in docs/datenschutz.md.
 * ⚠️ Die Fristen sind fachlich begründete Vorschläge und vor dem Livebetrieb rechtlich prüfen zu lassen.
 */
export const RETENTION_DAYS = {
  /** Gelesene Mitteilungen */
  readNotifications: 180,
  /** Alle Mitteilungen */
  notifications: 365,
  /** Audit-Log (Sicherheitsereignisse, Moderationsaktionen) */
  auditLog: 365,
  /** Erledigte Meldungen samt Verlauf */
  closedReports: 730,
  /** Moderationsentscheidungen und Einsprüche, die nicht mehr wirksam sind */
  decisions: 730,
  /** Anonymisierter Platzhalter eines gelöschten Kontos nach Abschluss der Löschung */
  deletedAccountPlaceholder: 730,
  /** Technische Fehlerübersicht (ohne Personenbezug) – nach letztem Auftreten */
  errorEvents: 30,
} as const;
