import Image, { type StaticImageData } from 'next/image';

/**
 * Foto rechts im Seitenkopf (Deals, Dienstleistungen). Läuft nach links weich in die Kopf-Farbe aus, damit der Text davor
 * immer lesbar bleibt; erst ab großen Bildschirmen sichtbar. Der Kopf braucht `relative isolate overflow-hidden`.
 */
export function HeaderPhoto({ src, position = 'center' }: { src: StaticImageData; position?: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-y-0 right-0 -z-10 hidden w-[46%] [mask-image:linear-gradient(to_right,transparent,black_45%)] lg:block"
    >
      <Image src={src} alt="" fill sizes="46vw" placeholder="blur" className="object-cover" style={{ objectPosition: position }} />
    </div>
  );
}
