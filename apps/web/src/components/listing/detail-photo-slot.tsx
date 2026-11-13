'use client';

import { useSyncExternalStore, ViewTransition } from 'react';
import { Skeleton } from '@marktat/ui';
import { freshPhoto, PHOTO_TRANSITION_NAME } from '@/lib/photo-transition';

const noop = () => () => {};

/**
 * Platz der Galerie, solange die Anzeige lädt. Kommt man von einer Karte, steht hier sofort deren Foto –
 * der Browser lässt es von der Karte herübergleiten. Sonst (direkter Aufruf, Server) ein grauer Platzhalter.
 */
export function DetailPhotoSlot() {
  const photo = useSyncExternalStore(noop, freshPhoto, () => null);

  if (!photo) return <Skeleton className="aspect-[16/10]" />;
  return (
    <div className="flex aspect-[16/10] justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-950 dark:bg-black">
      <ViewTransition name={PHOTO_TRANSITION_NAME} share="photo-morph" default="none">
        {/* eslint-disable-next-line @next/next/no-img-element -- dasselbe Vorschaubild wie auf der Karte, schon im Browser-Cache */}
        <img
          src={photo.src}
          alt=""
          data-testid="detail-photo-slot"
          className="aspect-[4/3] h-full bg-cover bg-center object-cover"
          style={photo.placeholder ? { backgroundImage: `url(${photo.placeholder})` } : undefined}
        />
      </ViewTransition>
    </div>
  );
}
