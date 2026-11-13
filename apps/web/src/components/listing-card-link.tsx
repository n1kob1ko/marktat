'use client';

import Link from 'next/link';
import { useRef, useSyncExternalStore, ViewTransition, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { activePhoto, PHOTO_TRANSITION_NAME, rememberPhoto, subscribePhoto } from '@/lib/photo-transition';

/**
 * Link einer Anzeigenkarte, der die ganze Karte abdeckt. Beim Klick merkt er sich das Foto der Karte,
 * damit es auf der Detailseite sofort da ist und dorthin gleitet (lib/photo-transition.ts).
 */
export function ListingCardLink({ href, children }: { href: string; children: ReactNode }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Neuer Tab oder neues Fenster: Die Seite bleibt, wie sie ist
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const image = event.currentTarget.closest('article')?.querySelector<HTMLImageElement>('img[data-card-photo]');
    // Sofort übernehmen: Das Foto muss seinen Namen tragen, bevor der Seitenwechsel beginnt
    if (image) flushSync(() => rememberPhoto(image, image.dataset.placeholder || null));
  }

  return (
    <Link href={href} onClick={onClick} className="after:absolute after:inset-0 focus-visible:outline-none">
      {children}
    </Link>
  );
}

/**
 * Foto einer Anzeigenkarte. Bis es geladen ist, steht dahinter seine verschwommene Miniatur (16 × 12 px, steckt im HTML).
 * Nur das Foto der eben angeklickten Karte trägt den Namen, unter dem es in die Anzeige gleitet.
 */
export function CardPhoto({ src, placeholder }: { src: string; placeholder: string | null }) {
  const image = useRef<HTMLImageElement>(null);
  const active = useSyncExternalStore(
    subscribePhoto,
    () => image.current !== null && activePhoto() === image.current,
    () => false,
  );
  return (
    <ViewTransition name={active ? PHOTO_TRANSITION_NAME : undefined} share="photo-morph" default="none">
      {/* eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert (WebP 480 × 360) */}
      <img
        ref={image}
        src={src}
        alt=""
        width={480}
        height={360}
        className="size-full bg-cover bg-center object-cover"
        loading="lazy"
        decoding="async"
        data-card-photo=""
        data-placeholder={placeholder ?? undefined}
        style={placeholder ? { backgroundImage: `url(${placeholder})` } : undefined}
      />
    </ViewTransition>
  );
}
