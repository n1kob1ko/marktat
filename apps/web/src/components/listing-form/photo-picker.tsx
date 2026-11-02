'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, ImageUp, Sparkles, Undo2, X } from 'lucide-react';
import { Alert, Button, Spinner } from '@marktat/ui';
import { AUTOFILL_MAX_PHOTOS, AUTOFILL_UPLOAD_EDGE, MAX_IMAGES_PER_LISTING, type AutofillSuggestion } from '@marktat/shared';

export interface PickedPhoto {
  key: string;
  /** Verkleinertes JPEG ohne Metadaten – so geht es an die KI und später ins Inserat */
  blob: Blob;
  url: string;
}

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; filled: string[] } | { kind: 'empty' } | { kind: 'error'; message: string };

interface PhotoPickerProps {
  /** KI-Auswertung anbieten (nur wenn sie in der API eingeschaltet ist) */
  ai: boolean;
  onPhotosChange: (photos: PickedPhoto[]) => void;
  /** Übernimmt die Vorschläge ins Formular und liefert, was ausgefüllt wurde (für die Meldung) */
  onSuggestion: (suggestion: AutofillSuggestion) => string[];
  onUndo: () => void;
}

let counter = 0;
const newKey = () => `foto-${++counter}`;

/**
 * Verkleinert im Browser (spart am Handy Datenvolumen und Zeit beim Hochladen) und erzeugt immer ein JPEG ohne
 * Metadaten. Die API speichert Bilder ohnehin höchstens mit 1600 px, größer bringt also nichts.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, AUTOFILL_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/jpeg', 0.88));
}

/**
 * Fotos gleich im Formular: am Handy öffnet „Foto aufnehmen“ die Kamera, „Aus Galerie wählen“ nimmt mehrere auf einmal.
 * Mit eingeschalteter KI füllt „Mit KI ausfüllen“ Kategorie, Titel, Beschreibung und Details aus den Fotos aus.
 * Hochgeladen werden die Fotos erst nach dem Speichern des Inserats (Bilder-Schritt, automatisch).
 */
export function PhotoPicker({ ai, onPhotosChange, onSuggestion, onUndo }: PhotoPickerProps) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [adding, setAdding] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** „Mit KI Inserat aufgeben“ aufgeklappt: Kamera oder Galerie wählen */
  const [aiMenu, setAiMenu] = useState(false);
  const current = useRef<PickedPhoto[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Vorschau-Adressen beim Verlassen der Seite freigeben
  useEffect(() => () => current.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const update = (next: PickedPhoto[]) => {
    current.current = next;
    setPhotos(next);
    onPhotosChange(next);
  };

  async function add(files: File[]) {
    if (!files.length) return;
    setAdding(true);
    const found: string[] = [];
    const added: PickedPhoto[] = [];
    const free = MAX_IMAGES_PER_LISTING - current.current.length;
    if (files.length > free) found.push(`Es sind höchstens ${MAX_IMAGES_PER_LISTING} Fotos möglich.`);
    for (const file of files.slice(0, Math.max(0, free))) {
      try {
        const blob = await shrink(file);
        added.push({ key: newKey(), blob, url: URL.createObjectURL(blob) });
      } catch {
        found.push(`${file.name || 'Ein Foto'} kann dein Browser nicht öffnen. Bitte verwende JPEG oder PNG.`);
      }
    }
    setProblems(found);
    update([...current.current, ...added]);
    setAdding(false);
    if (added.length) setAiMenu(false);
  }

  const pick = (input: HTMLInputElement | null) => {
    const files = Array.from(input?.files ?? []);
    if (input) input.value = '';
    void add(files);
  };

  const remove = (key: string) => {
    const photo = current.current.find((p) => p.key === key);
    if (photo) URL.revokeObjectURL(photo.url);
    update(current.current.filter((p) => p.key !== key));
  };

  async function analyze() {
    const selected = current.current.slice(0, AUTOFILL_MAX_PHOTOS);
    if (!selected.length) return;
    setPhase({ kind: 'working' });
    const form = new FormData();
    selected.forEach((photo, i) => form.append('foto', photo.blob, `foto-${i + 1}.jpg`));
    const response = await fetch('/api/foto-assistent', { method: 'POST', body: form }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as (AutofillSuggestion & { message?: string }) | null;
    if (!response?.ok || !data) {
      setPhase({ kind: 'error', message: data?.message ?? 'Die Fotos konnten gerade nicht ausgewertet werden. Bitte versuche es noch einmal.' });
      return;
    }
    if (!data.recognized) {
      setPhase({ kind: 'empty' });
      return;
    }
    setPhase({ kind: 'done', filled: onSuggestion(data) });
  }

  const working = phase.kind === 'working';
  const full = photos.length >= MAX_IMAGES_PER_LISTING;

  return (
    <section aria-labelledby="fotos" className="rounded-[var(--radius-card)] border border-brand-600/25 bg-brand-50/60 p-5 sm:p-6">
      <h2 id="fotos" className="font-sans text-lg font-semibold tracking-normal text-ink-950">
        Fotos
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">Bis zu {MAX_IMAGES_PER_LISTING} Fotos. Das erste ist das Titelbild.</p>

      {photos.length ? (
        <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Deine Fotos">
          {photos.map((photo, i) => (
            <li key={photo.key} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- lokale Vorschau (blob:) */}
              <img src={photo.url} alt={`Foto ${i + 1}`} className="size-full object-cover" />
              {i === 0 ? (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-primary px-2 py-0.5 text-[0.6875rem] font-semibold text-white">Titelbild</span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(photo.key)}
                aria-label={`Foto ${i + 1} entfernen`}
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-ink-950/70 text-white hover:bg-ink-950/85 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={photos.length ? 'outline' : 'primary'} onClick={() => cameraRef.current?.click()} disabled={adding || full}>
          <Camera className="size-4" aria-hidden="true" /> {photos.length ? 'Noch ein Foto' : 'Foto aufnehmen'}
        </Button>
        <Button variant="outline" onClick={() => galleryRef.current?.click()} disabled={adding || full}>
          <ImageUp className="size-4" aria-hidden="true" /> Aus Galerie wählen
        </Button>
        {ai && photos.length ? (
          <Button variant="accent" onClick={() => void analyze()} loading={working} disabled={working || adding}>
            {!working ? <Sparkles className="size-4" aria-hidden="true" /> : null}
            {working ? 'KI liest deine Fotos …' : 'Mit KI ausfüllen'}
          </Button>
        ) : null}
        {ai && !photos.length ? (
          <Button variant="accent" onClick={() => setAiMenu((open) => !open)} aria-expanded={aiMenu} aria-controls="ki-fotos" disabled={adding}>
            <Sparkles className="size-4" aria-hidden="true" /> Mit KI Inserat aufgeben
          </Button>
        ) : null}
      </div>
      {ai && aiMenu && !photos.length ? (
        <div id="ki-fotos" className="mt-3 rounded-xl border border-accent-500/40 bg-surface p-4">
          <p className="text-sm font-semibold text-ink-900">Foto vom Artikel machen oder auswählen, dann „Mit KI ausfüllen“ tippen.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="accent" size="sm" onClick={() => cameraRef.current?.click()}>
              <Camera className="size-4" aria-hidden="true" /> Mit Kamera fotografieren
            </Button>
            <Button variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
              <ImageUp className="size-4" aria-hidden="true" /> Foto aus Galerie
            </Button>
          </div>
        </div>
      ) : null}
      {/* Zwei Felder: „capture“ öffnet am Handy direkt die Kamera, das zweite die Galerie (mehrere auf einmal) */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Foto aufnehmen"
        onChange={(e) => pick(e.currentTarget)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Aus Galerie wählen"
        onChange={(e) => pick(e.currentTarget)}
      />
      {ai && photos.length > AUTOFILL_MAX_PHOTOS ? (
        <p className="mt-2 text-xs text-ink-500">Die KI schaut sich die ersten {AUTOFILL_MAX_PHOTOS} Fotos an.</p>
      ) : null}

      <div aria-live="polite" className="mt-4 space-y-3 empty:hidden">
        {adding ? (
          <p className="flex items-center gap-2 text-sm text-ink-700">
            <Spinner className="size-4" /> Fotos werden vorbereitet …
          </p>
        ) : null}
        {problems.length ? (
          <Alert tone="warning">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </Alert>
        ) : null}
        {working ? (
          <p className="flex items-center gap-2 text-sm text-ink-700">
            <Spinner className="size-4" /> Die KI liest deine Fotos … das dauert meist nur ein paar Sekunden.
          </p>
        ) : null}
        {phase.kind === 'done' ? (
          <Alert tone="success" title={phase.filled.length ? `Ausgefüllt: ${phase.filled.join(', ')}` : 'Wir konnten leider nichts Konkretes ablesen.'}>
            <p>Bitte prüfe die Vorschläge. Zustand, Preis und Standort trägst du selbst ein.</p>
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
            Auf den Fotos konnten wir nichts erkennen. Versuch es mit einem Foto aus der Nähe, auf dem Marke, Modell oder Typenschild gut lesbar sind.
          </Alert>
        ) : null}
        {phase.kind === 'error' ? <Alert tone="danger">{phase.message}</Alert> : null}
      </div>

      {ai && (aiMenu || photos.length) ? (
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          Die KI-Auswertung macht Anthropic, ohne Training mit deinen Fotos.{' '}
          <Link href="/datenschutz#foto-assistent" className="underline underline-offset-2 hover:text-ink-700">
            Datenschutz
          </Link>
        </p>
      ) : null}
    </section>
  );
}
