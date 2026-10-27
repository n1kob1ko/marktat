'use client';

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '@marktat/ui';
import type { ListingImage } from '@marktat/shared';

/** Bildergalerie der Detailseite: großes Bild plus Vorschaubilder zum Umschalten. */
export function ListingGallery({ images, title }: { images: ListingImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const current = images[Math.min(active, images.length - 1)];

  if (!current) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface sm:h-56">
        <div className="text-center text-ink-500">
          <ImageIcon className="mx-auto size-10" aria-hidden="true" />
          <p className="mt-2 text-sm">Keine Bilder vorhanden</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Bilder" className="space-y-3">
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink-950">
        {/* eslint-disable-next-line @next/next/no-img-element -- serverseitig optimiertes WebP (max. 1600 px) */}
        <img
          key={current.id}
          src={current.url}
          alt={images.length > 1 ? `${title} – Bild ${active + 1} von ${images.length}` : title}
          width={current.width || undefined}
          height={current.height || undefined}
          className="max-h-full max-w-full object-contain"
          fetchPriority="high"
        />
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Bild ${index + 1} anzeigen`}
                aria-current={index === active ? 'true' : undefined}
                className={cn(
                  'block h-16 w-20 overflow-hidden rounded-lg border-2 sm:h-20 sm:w-26',
                  index === active
                    ? 'border-brand-600'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- serverseitig optimiertes Vorschaubild */}
                <img
                  src={image.thumbUrl}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
