'use client';

import './globals.css';

/** Letzte Auffangseite, wenn selbst das Grundgerüst (Header, Layout) nicht geladen werden kann. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="de-AT" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center bg-canvas px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-ink-950">MarktAT ist gerade nicht erreichbar</h1>
        <p className="mt-2 max-w-md text-ink-600">
          Wir haben ein technisches Problem und arbeiten daran. Bitte versuche es in ein paar Minuten noch einmal.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-8 rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          Erneut versuchen
        </button>
      </body>
    </html>
  );
}
