/**
 * Das Logo an einer einzigen Stelle: Kopfzeile (logo.tsx) und Link-Vorschaubilder (lib/og-image.tsx)
 * zeichnen es von hier. Für ein neues Logo diese Datei und app/icon.svg austauschen – sonst nichts.
 */

/** Wortmarke, zweifarbig: „Markt“ in Schriftfarbe, „erl“ in Akzentfarbe */
export const WORDMARK = { main: 'Markt', accent: 'erl' } as const;

export interface MarkColors {
  /** Fläche des Preisschilds */
  shape: string;
  /** Loch im Schild */
  cutout: string;
  /** Bergspitze */
  accent: string;
}

/** Als Funktion (nicht als Komponente), damit auch die Bild-Erzeugung für Link-Vorschauen sie zeichnen kann */
export function brandMarkSvg(colors: MarkColors, props: { className?: string; width?: number; height?: number } = {}) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path
        d="M4 9.5A5.5 5.5 0 0 1 9.5 4h9.38a5.5 5.5 0 0 1 3.89 1.61l5.62 5.62a5.5 5.5 0 0 1 0 7.78l-9.38 9.38a5.5 5.5 0 0 1-7.78 0l-5.62-5.62A5.5 5.5 0 0 1 4 18.88Z"
        fill={colors.shape}
      />
      <circle cx="11" cy="11" r="2.4" fill={colors.cutout} />
      <path d="m10.5 22.5 5-7.5 2.6 3.6 1.9-2.4 3.5 5.3Z" fill={colors.accent} />
    </svg>
  );
}
