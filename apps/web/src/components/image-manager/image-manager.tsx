'use client';

import { useEffect, useRef, useState, useTransition, type DragEvent } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2, TriangleAlert } from 'lucide-react';
import { Button, cn, Spinner } from '@marktat/ui';
import {
  IMAGE_ACCEPT,
  IMAGE_TYPE_LABEL,
  isImageContentType,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_LISTING,
  type ImageUploadTicket,
  type ListingImage,
} from '@marktat/shared';
import {
  completeImageUpload,
  deleteImage,
  reorderImages,
  requestImageUpload,
  setMainImage,
  type ImageActionResult,
} from './actions';

interface UploadItem {
  key: string;
  name: string;
  preview: string;
  phase: 'waiting' | 'uploading' | 'processing' | 'error';
  progress: number;
  error?: string;
}

/** PUT direkt an den Speicher (R2) mit Fortschrittsanzeige. Die URL ist signiert und 5 Minuten gültig. */
function putFile(ticket: ImageUploadTicket, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status)));
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(file);
  });
}

function checkFile(file: File): string | null {
  if (!isImageContentType(file.type)) return `${file.name}: Erlaubt sind nur ${IMAGE_TYPE_LABEL}.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: Ein Bild darf höchstens 15 MB groß sein.`;
  if (file.size === 0) return `${file.name}: Die Datei ist leer.`;
  return null;
}

export function ImageManager({
  listingId,
  initialImages,
}: {
  listingId: string;
  initialImages: ListingImage[];
}) {
  const [images, setImages] = useState(initialImages);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const running = useRef(false);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const activeUploads = uploads.filter((u) => u.phase !== 'error').length;
  const remaining = MAX_IMAGES_PER_LISTING - images.length - activeUploads;

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const dropUpload = (key: string) =>
    setUploads((list) => {
      const item = list.find((u) => u.key === key);
      if (item) {
        URL.revokeObjectURL(item.preview);
        previews.current.delete(item.preview);
      }
      return list.filter((u) => u.key !== key);
    });

  /** Nacheinander hochladen: hält die Reihenfolge stabil und schont langsame Verbindungen. */
  async function runQueue() {
    if (running.current) return;
    running.current = true;
    while (queue.current.length > 0) {
      const { key, file } = queue.current.shift()!;
      patchUpload(key, { phase: 'uploading' });
      const ticket = await requestImageUpload(listingId, {
        contentType: file.type,
        size: file.size,
      });
      if (!ticket.ok) {
        patchUpload(key, { phase: 'error', error: ticket.message });
        continue;
      }
      try {
        await putFile(ticket.data, file, (progress) => patchUpload(key, { progress }));
      } catch {
        patchUpload(key, {
          phase: 'error',
          error: 'Der Upload ist fehlgeschlagen. Bitte versuche es erneut.',
        });
        continue;
      }
      patchUpload(key, { phase: 'processing', progress: 1 });
      const done = await completeImageUpload(listingId, ticket.data.imageId);
      if (!done.ok) {
        patchUpload(key, { phase: 'error', error: done.message });
        continue;
      }
      setImages((list) => [...list, { ...done.data, position: list.length }]);
      dropUpload(key);
      setStatus(`${file.name} wurde hinzugefügt.`);
    }
    running.current = false;
  }

  function addFiles(files: FileList | File[]) {
    const problems: string[] = [];
    const accepted: UploadItem[] = [];
    let slots = remaining;
    for (const file of Array.from(files)) {
      const problem = checkFile(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      if (slots <= 0) {
        problems.push(`${file.name}: Es sind höchstens ${MAX_IMAGES_PER_LISTING} Bilder möglich.`);
        continue;
      }
      slots -= 1;
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      accepted.push({ key, name: file.name, preview, phase: 'waiting', progress: 0 });
      queue.current.push({ key, file });
    }
    setMessages(problems);
    if (accepted.length) {
      setUploads((list) => [...list, ...accepted]);
      void runQueue();
    }
  }

  function apply(action: () => Promise<ImageActionResult<ListingImage[]>>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setImages(result.data);
        setMessages([]);
        setStatus(done);
      } else {
        setMessages([result.message]);
      }
    });
  }

  const move = (index: number, direction: -1 | 1) => {
    const order = images.map((image) => image.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + direction, 0, moved!);
    apply(() => reorderImages(listingId, order), 'Die Reihenfolge wurde gespeichert.');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-canvas',
        )}
      >
        <ImagePlus className="size-8 text-brand-700" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink-900">Bilder hierher ziehen oder auswählen</p>
          <p className="mt-1 text-sm text-ink-500">
            {IMAGE_TYPE_LABEL}, bis 15 MB pro Bild, höchstens {MAX_IMAGES_PER_LISTING} Bilder.
            Standortdaten und andere Metadaten entfernen wir automatisch.
          </p>
        </div>
        <input
          ref={inputRef}
          id="bilder-auswahl"
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <Button
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={remaining <= 0}
        >
          Bilder auswählen
        </Button>
        <p className="text-xs text-ink-500">
          {images.length} von {MAX_IMAGES_PER_LISTING} Bildern
        </p>
      </div>

      {messages.length ? (
        <div
          role="alert"
          className="space-y-1 rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {images.length === 0 && uploads.length === 0 ? (
        <p className="text-sm text-ink-500">
          Noch keine Bilder. Anzeigen mit Bildern werden deutlich öfter angesehen.
        </p>
      ) : (
        <ul
          aria-label="Bilder der Anzeige"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {images.map((image, index) => (
            <li key={image.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="relative aspect-[4/3] bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element -- bereits serverseitig optimiertes WebP */}
                <img
                  src={image.thumbUrl}
                  alt={`Bild ${index + 1}`}
                  className="size-full object-cover"
                />
                {index === 0 ? (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">
                    <Star className="size-3" aria-hidden="true" /> Hauptbild
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    disabled={pending || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Bild ${index + 1} nach vorne`}
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    disabled={pending || index === images.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Bild ${index + 1} nach hinten`}
                  >
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  {index > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      disabled={pending}
                      onClick={() =>
                        apply(
                          () => setMainImage(listingId, image.id),
                          'Das Hauptbild wurde geändert.',
                        )
                      }
                      aria-label={`Bild ${index + 1} als Hauptbild`}
                      title="Als Hauptbild"
                    >
                      <Star className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                    disabled={pending}
                    onClick={() =>
                      apply(() => deleteImage(listingId, image.id), 'Das Bild wurde gelöscht.')
                    }
                    aria-label={`Bild ${index + 1} löschen`}
                    title="Löschen"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
          {uploads.map((item) => (
            <li key={item.key} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="relative aspect-[4/3] bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element -- lokale Vorschau (blob:) vor dem Upload */}
                <img
                  src={item.preview}
                  alt=""
                  className={cn('size-full object-cover', item.phase !== 'error' && 'opacity-60')}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  {item.phase === 'error' ? (
                    <TriangleAlert className="size-7 text-danger-600" aria-hidden="true" />
                  ) : (
                    <span className="flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1 text-xs font-semibold text-ink-800">
                      <Spinner className="size-3.5" />
                      {item.phase === 'waiting'
                        ? 'Wartet …'
                        : item.phase === 'uploading'
                          ? `${Math.round(item.progress * 100)} %`
                          : 'Wird optimiert …'}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-2 text-xs">
                <p className="truncate text-ink-700">{item.name}</p>
                {item.error ? (
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="text-danger-700">{item.error}</p>
                    <button
                      type="button"
                      className="shrink-0 font-semibold text-ink-600 underline"
                      onClick={() => dropUpload(item.key)}
                    >
                      Entfernen
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
