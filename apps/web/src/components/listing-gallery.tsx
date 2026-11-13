'use client';

import { useEffect, useRef, useState, ViewTransition, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';
import { cn } from '@marktat/ui';
import type { ListingImage } from '@marktat/shared';
import { rubberBand, swipeTarget } from '@/lib/motion';
import { freshPhoto, PHOTO_TRANSITION_NAME, placeholderBox } from '@/lib/photo-transition';

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  width: number;
  /** Richtung steht erst nach ein paar Pixeln fest: seitlich = wir wischen, senkrecht = die Seite scrollt */
  axis: 'x' | 'y' | null;
  dx: number;
}

/**
 * Bildergalerie der Detailseite: großes Bild zum Wischen (Finger oder Maus), Pfeile, Zähler und Vorschaubilder.
 *
 * Bewegung: Beim Ziehen folgt das Bild dem Finger ohne Verzögerung; erst nach dem Loslassen rastet es ein.
 * Am ersten und letzten Bild gibt es wie ein Gummiband nach. Ein Sprung über die Vorschaubilder gleitet (ease-in-out).
 */
export function ListingGallery({ images, title }: { images: ListingImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const [move, setMove] = useState<'snap' | 'jump'>('snap');
  // Geladen wird nur, was gebraucht wird: das gezeigte Bild und seine Nachbarn (damit beim Wischen nichts leer ist)
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
  // Bis ein Bild geladen ist, liegt seine verschwommene Miniatur dahinter – danach wird sie nicht mehr gebraucht
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  // Von einer Karte gekommen: Das Vorschaubild liegt schon im Browser-Cache und überbrückt, bis das große Bild da ist
  const [fromCard] = useState(() => typeof window !== 'undefined' && freshPhoto() !== null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const thumbs = useRef<HTMLUListElement>(null);
  const drag = useRef<Drag | null>(null);

  const count = images.length;
  const index = Math.min(active, Math.max(count - 1, 0));

  const reveal = (center: number) =>
    setSeen((current) => {
      const next = new Set(current);
      for (const i of [center - 1, center, center + 1]) if (i >= 0 && i < count) next.add(i);
      return next.size === current.size ? current : next;
    });

  const markLoaded = (i: number) => setLoaded((current) => (current.has(i) ? current : new Set(current).add(i)));

  /**
   * Miniatur hinter einem Bild, solange es lädt. Beim ersten Bild nach einem Klick auf eine Karte ist es deren
   * (schon geladenes) Vorschaubild – es bleibt liegen, denn dorthin gleitet das Foto der Karte (View Transition).
   */
  function backdrop(image: ListingImage, i: number) {
    const landing = i === 0 && fromCard;
    if (loaded.has(i) && !landing) return null;
    const layers = [landing ? image.thumbUrl : null, image.placeholder].filter(Boolean);
    if (!layers.length) return null;
    const box = placeholderBox(image.width, image.height);
    const layer = (
      <span
        aria-hidden="true"
        data-testid={landing ? 'gallery-landing' : undefined}
        className="absolute top-1/2 left-1/2 -translate-1/2 bg-cover bg-center"
        style={{ width: `${box.width}%`, height: `${box.height}%`, backgroundImage: layers.map((url) => `url(${url})`).join(', ') }}
      />
    );
    if (!landing) return layer;
    return (
      <ViewTransition name={PHOTO_TRANSITION_NAME} share="photo-morph" default="none">
        {layer}
      </ViewTransition>
    );
  }

  function go(target: number, kind: 'snap' | 'jump') {
    const next = Math.min(Math.max(target, 0), count - 1);
    setMove(kind);
    setActive(next);
    reveal(next);
    return next;
  }

  // Kurz nach dem Laden die Nachbarn des ersten Bilds holen – das Hauptbild hat Vorrang
  useEffect(() => {
    if (count < 2) return;
    const timer = setTimeout(() => {
      setSeen((current) => (current.has(1) ? current : new Set(current).add(1)));
    }, 600);
    return () => clearTimeout(timer);
  }, [count]);

  // Aktives Vorschaubild in die Mitte der Leiste holen (nur seitlich – die Seite selbst scrollt nicht mit)
  useEffect(() => {
    const list = thumbs.current;
    const item = list?.children[index] as HTMLElement | undefined;
    if (!list || !item || typeof list.scrollTo !== 'function') return;
    list.scrollTo({ left: item.offsetLeft - (list.clientWidth - item.clientWidth) / 2, behavior: 'smooth' });
  }, [index]);

  if (count === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface sm:h-56">
        <div className="text-center text-ink-500">
          <ImageIcon className="mx-auto size-10" aria-hidden="true" />
          <p className="mt-2 text-sm">Keine Bilder vorhanden</p>
        </div>
      </div>
    );
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (count < 2 || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // Auf den Pfeilen wird geklickt, nicht gewischt
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      width: viewport.current?.clientWidth ?? 1,
      axis: null,
      dx: 0,
    };
    reveal(index);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const el = track.current;
    if (!current || !el || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (current.axis === 'x') {
        viewport.current?.setPointerCapture?.(event.pointerId);
        // Solange gehalten wird: keine Übergänge, das Bild klebt am Finger
        el.dataset.dragging = 'true';
      }
    }
    if (current.axis !== 'x') return;
    const limited = Math.max(-current.width, Math.min(current.width, dx));
    const pastStart = index === 0 && limited > 0;
    const pastEnd = index === count - 1 && limited < 0;
    const offset = pastStart || pastEnd ? Math.sign(limited) * rubberBand(Math.abs(limited), current.width) : limited;
    current.dx = limited;
    el.style.translate = `calc(${-index * 100}% + ${offset.toFixed(1)}px)`;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    const el = track.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (current.axis !== 'x' || !el) return;
    const step = cancelled ? 0 : swipeTarget(current.dx, performance.now() - current.startedAt, current.width);
    const next = go(index + step, 'snap');
    delete el.dataset.dragging;
    el.style.translate = `${-next * 100}%`;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (count < 2) return;
    if (event.key === 'ArrowLeft') go(index - 1, 'jump');
    else if (event.key === 'ArrowRight') go(index + 1, 'jump');
    else return;
    event.preventDefault();
  }

  const arrow =
    'press absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface/95 text-ink-900 shadow-md ring-1 ring-ink-900/10 ' +
    'hover:bg-surface disabled:pointer-events-none disabled:opacity-0 [@media(hover:hover)]:flex';

  return (
    <section aria-label="Bilder" aria-roledescription="Bildergalerie" className="space-y-3" onKeyDown={onKeyDown}>
      <div
        ref={viewport}
        data-testid="gallery-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        className={cn(
          'relative aspect-[16/10] touch-pan-y overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-950 select-none dark:bg-black',
          count > 1 && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <div ref={track} data-testid="gallery-track" data-move={move} className="swipe-track flex h-full" style={{ translate: `${-index * 100}%` }}>
          {images.map((image, i) => (
            <div
              key={image.id}
              aria-hidden={i === index ? undefined : true}
              className="relative flex h-full w-full shrink-0 items-center justify-center"
            >
              {backdrop(image, i)}
              {seen.has(i) ? (
                // eslint-disable-next-line @next/next/no-img-element -- serverseitig optimiertes WebP (max. 1600 px)
                <img
                  src={image.url}
                  alt={count > 1 ? `${title} – Bild ${i + 1} von ${count}` : title}
                  width={image.width || undefined}
                  height={image.height || undefined}
                  draggable={false}
                  onLoad={() => markLoaded(i)}
                  // Schon vor dem Hydrieren fertig geladen: dann kommt kein onLoad mehr
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0) markLoaded(i);
                  }}
                  className="relative max-h-full max-w-full object-contain"
                  fetchPriority={i === 0 ? 'high' : 'low'}
                />
              ) : null}
            </div>
          ))}
        </div>

        {count > 1 ? (
          <>
            <button type="button" onClick={() => go(index - 1, 'jump')} disabled={index === 0} aria-label="Vorheriges Bild" className={cn(arrow, 'left-3')}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => go(index + 1, 'jump')} disabled={index === count - 1} aria-label="Nächstes Bild" className={cn(arrow, 'right-3')}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
            <p
              className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white tabular-nums"
              data-testid="gallery-counter"
              aria-live="polite"
            >
              <span className="sr-only">Bild </span>
              {index + 1} / {count}
            </p>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul ref={thumbs} className="relative flex gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1">
          {images.map((image, i) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                onClick={() => go(i, 'jump')}
                aria-label={`Bild ${i + 1} anzeigen`}
                aria-current={i === index ? 'true' : undefined}
                className={cn(
                  'press block h-16 w-20 overflow-hidden rounded-lg border-2 sm:h-20 sm:w-26',
                  i === index ? 'border-brand-600' : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- serverseitig optimiertes Vorschaubild */}
                <img src={image.thumbUrl} alt="" draggable={false} className="size-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
