import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@marktat/ui';
import { categoryPhotoUrl, type CategoryPhoto } from '@/content/category-photos';

/** Kachel mit Foto (oder Symbol, wenn es für die Kategorie keins gibt); Name und Anzahl stehen unten auf dem Bild */
export function CategoryPhotoTile({
  href,
  name,
  count,
  hint,
  photo,
  icon,
  sizes,
  className,
  unit = ['Anzeige', 'Anzeigen'],
}: {
  href: string;
  name: string;
  count?: number;
  hint?: string;
  photo?: CategoryPhoto;
  icon: React.ReactNode;
  /** Breite der Kachel im Layout, damit nicht größer als nötig geladen wird */
  sizes: string;
  className?: string;
  /** Wort zur Anzahl (Einzahl, Mehrzahl) */
  unit?: [string, string];
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={cn(
        'group relative flex overflow-hidden rounded-xl bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        className,
      )}
      style={photo ? { backgroundColor: photo.color } : undefined}
    >
      {photo ? (
        <Image
          src={categoryPhotoUrl(photo)}
          alt=""
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center pb-8 text-white/90">{icon}</span>
      )}
      <span
        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent"
        aria-hidden="true"
      />
      <span className="relative mt-auto block w-full p-2 sm:p-3">
        <span className="block text-xs leading-tight font-semibold text-white sm:text-sm">
          {name}
        </span>
        {count ? (
          <span className="mt-0.5 block text-xs text-white/80 tabular-nums">
            {count.toLocaleString('de-AT')} {count === 1 ? unit[0] : unit[1]}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
