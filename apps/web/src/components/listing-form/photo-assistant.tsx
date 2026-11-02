'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, ImageUp, Sparkles, Undo2 } from 'lucide-react';
import { Alert, Button, Checkbox, Spinner } from '@marktat/ui';
import { AUTOFILL_UPLOAD_EDGE, type AutofillSuggestion } from '@marktat/shared';

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; filled: string[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

interface PhotoAssistantProps {
  /** Übernimmt die Vorschläge ins Formular und liefert, was ausgefüllt wurde (für die Meldung) */
  onSuggestion: (suggestion: AutofillSuggestion) => string[];
  onUndo: () => void;
  /** Das ausgewertete Foto (verkleinert) und ob es ins Inserat soll – gespeichert wird es erst beim Absenden */
  onPhoto: (photo: Blob | null) => void;
}

/** Verkleinert im Browser (spart Datenvolumen am Handy) und erzeugt immer ein JPEG ohne Metadaten. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, AUTOFILL_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/jpeg', 0.88),
  );
}

/**
 * „Foto machen – wir füllen aus“: Ein Foto vom Artikel oder seiner Verpackung, und Kategorie, Titel, Beschreibung
 * und Details (z. B. Grafikspeicher) werden vorgeschlagen. Alles bleibt änderbar; erst „Veröffentlichen“ speichert.
 */
export function PhotoAssistant({ onSuggestion, onUndo, onPhoto }: PhotoAssistantProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [preview, setPreview] = useState<string | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function analyze(file: File) {
    setPhase({ kind: 'working' });
    let blob: Blob;
    try {
      blob = await shrink(file);
    } catch {
      setPhase({ kind: 'error', message: 'Dieses Bild kann dein Browser nicht öffnen. Bitte versuche ein Foto im Format JPEG oder PNG.' });
      return;
    }
    setPreview(URL.createObjectURL(blob));
    const response = await fetch('/api/foto-assistent', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as (AutofillSuggestion & { message?: string }) | null;
    if (!response?.ok || !data) {
      setPhase({ kind: 'error', message: data?.message ?? 'Das Foto konnte gerade nicht ausgewertet werden. Bitte versuche es noch einmal.' });
      return;
    }
    if (!data.recognized) {
      setPhase({ kind: 'empty' });
      return;
    }
    setPhoto(blob);
    onPhoto(keepPhoto ? blob : null);
    setPhase({ kind: 'done', filled: onSuggestion(data) });
  }

  const pick = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (file) void analyze(file);
  };

  const working = phase.kind === 'working';

  return (
    <section aria-labelledby="foto-assistent" className="rounded-[var(--radius-card)] border border-brand-600/25 bg-brand-50/60 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex-1">
          <h2 id="foto-assistent" className="flex items-center gap-2 font-sans text-lg font-semibold tracking-normal text-ink-950">
            <Sparkles className="size-5 text-brand-700" aria-hidden="true" /> Foto machen – wir füllen aus
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
            Fotografiere den Artikel oder seine Verpackung. Wir schlagen Kategorie, Titel, Beschreibung und Details wie Speicher oder Marke vor –
            du prüfst alles, bevor du veröffentlichst.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => cameraRef.current?.click()} loading={working} disabled={working}>
              {!working ? <Camera className="size-4" aria-hidden="true" /> : null}
              {working ? 'Foto wird ausgewertet …' : 'Foto aufnehmen'}
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={working}>
              <ImageUp className="size-4" aria-hidden="true" /> Bild auswählen
            </Button>
          </div>
          {/* Zwei Felder: „capture“ öffnet am Handy direkt die Kamera, das zweite die Galerie bzw. Dateiauswahl */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Foto aufnehmen" onChange={(e) => pick(e.currentTarget)} />
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Bild auswählen" onChange={(e) => pick(e.currentTarget)} />
          <Checkbox
            className="mt-4"
            checked={keepPhoto}
            onChange={(e) => {
              setKeepPhoto(e.target.checked);
              onPhoto(e.target.checked ? photo : null);
            }}
            label="Foto auch als erstes Bild der Anzeige verwenden"
          />
        </div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- lokale Vorschau (blob:)
          <img src={preview} alt="Dein Foto" className="h-28 w-full rounded-xl border border-line object-cover sm:w-36" />
        ) : null}
      </div>

      <div aria-live="polite" className="mt-4 empty:hidden">
        {working ? (
          <p className="flex items-center gap-2 text-sm text-ink-700">
            <Spinner className="size-4" /> Wir lesen dein Foto … das dauert meist nur ein paar Sekunden.
          </p>
        ) : null}
        {phase.kind === 'done' ? (
          <Alert tone="success" title={phase.filled.length ? `Ausgefüllt: ${phase.filled.join(', ')}` : 'Wir konnten leider nichts Konkretes ablesen.'}>
            <p>Bitte prüfe die Vorschläge. Preis und Standort trägst du selbst ein.</p>
            {phase.filled.length ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 -ml-3"
                onClick={() => {
                  onUndo();
                  setPhase({ kind: 'idle' });
                }}
              >
                <Undo2 className="size-4" aria-hidden="true" /> Rückgängig
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {phase.kind === 'empty' ? (
          <Alert tone="warning">
            Auf dem Foto konnten wir nichts erkennen. Versuch es mit einem Foto aus der Nähe, auf dem Marke, Modell oder Typenschild gut lesbar sind.
          </Alert>
        ) : null}
        {phase.kind === 'error' ? <Alert tone="danger">{phase.message}</Alert> : null}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        Zur Auswertung geht das Foto an unseren KI-Dienstleister Anthropic und wird dort nicht zum Training verwendet. Mehr dazu in der{' '}
        <Link href="/datenschutz#foto-assistent" className="underline underline-offset-2 hover:text-ink-700">
          Datenschutzerklärung
        </Link>
        .
      </p>
    </section>
  );
}
