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
  hole: string;
  /** Das „m“ auf dem Schild */
  letter: string;
}

/** Preisschild mit „m“. Als Funktion (nicht als Komponente), damit auch die Bild-Erzeugung für Link-Vorschauen sie zeichnen kann */
export function brandMarkSvg(colors: MarkColors, props: { className?: string; width?: number; height?: number } = {}) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path
        d="M4 9.5A5.5 5.5 0 0 1 9.5 4h9.38a5.5 5.5 0 0 1 3.89 1.61l5.62 5.62a5.5 5.5 0 0 1 0 7.78l-9.38 9.38a5.5 5.5 0 0 1-7.78 0l-5.62-5.62A5.5 5.5 0 0 1 4 18.88Z"
        fill={colors.shape}
      />
      <circle cx="10.25" cy="10.25" r="2.3" fill={colors.hole} />
      <path
        d="M11.5 22V16.25A2.75 2.75 0 0 1 17 16.25V22M17 16.25A2.75 2.75 0 0 1 22.5 16.25V22"
        fill="none"
        stroke={colors.letter}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
