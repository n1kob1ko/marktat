/**
 * „Das Foto fliegt in die Anzeige“: Beim Klick auf eine Karte merkt sich die Seite das Vorschaubild.
 * Die Detailseite zeigt es sofort an der Stelle der Galerie (statt eines grauen Platzhalters), und der Browser
 * lässt es per View Transition von der Karte dorthin gleiten. Nur vorwärts, nur wo der Browser das kann.
 *
 * Der Übergang braucht auf beiden Seiten denselben Namen. Den bekommt immer nur die eben angeklickte Karte –
 * so kann dieselbe Anzeige mehrfach auf einer Seite stehen, ohne dass sich zwei Fotos den Namen teilen.
 */
export const PHOTO_TRANSITION_NAME = 'listing-photo';
/** So lange gilt ein gemerktes Foto als „gerade angeklickt“ */
const FRESH_MS = 4000;
/** So lange trägt das Foto der Karte den Namen – danach (z. B. beim Zurückgehen) gleitet nichts mehr */
const ACTIVE_MS = 1500;

export interface RememberedPhoto {
  src: string;
  placeholder: string | null;
  at: number;
}

let remembered: RememberedPhoto | null = null;
let active: HTMLImageElement | null = null;
let release: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setActive(image: HTMLImageElement | null) {
  if (release) clearTimeout(release);
  release = image ? setTimeout(() => setActive(null), ACTIVE_MS) : undefined;
  if (active === image) return;
  active = image;
  for (const listener of listeners) listener();
}

export function subscribePhoto(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Das Foto der eben angeklickten Karte (nur kurz, siehe ACTIVE_MS) */
export function activePhoto(): HTMLImageElement | null {
  return active;
}

/** Vom Klick auf eine Karte: Foto merken und für den Übergang auswählen */
export function rememberPhoto(image: HTMLImageElement, placeholder: string | null) {
  remembered = { src: image.currentSrc || image.src, placeholder, at: performance.now() };
  setActive(image);
}

/** Das gerade angeklickte Foto, falls der Klick eben erst war (sonst `null`) */
export function freshPhoto(now = performance.now()): RememberedPhoto | null {
  return remembered && now - remembered.at < FRESH_MS ? remembered : null;
}

/** Seitenverhältnis des Galerie-Rahmens (aspect-[16/10]) und der Vorschaubilder (480 × 360) */
const FRAME = 16 / 10;
const THUMB = 4 / 3;

/**
 * Größe der Miniatur hinter einem Galeriebild, in Prozent des Rahmens. Das große Bild wird in den Rahmen
 * eingepasst, die Miniatur ist ein 4:3-Ausschnitt aus seiner Mitte – sie liegt damit genau unter dem Bild
 * und schaut nirgends hervor, egal ob Hoch- oder Querformat.
 */
export function placeholderBox(width: number, height: number): { width: number; height: number } {
  const ratio = width > 0 && height > 0 ? width / height : THUMB;
  const image = ratio <= FRAME ? { width: (ratio / FRAME) * 100, height: 100 } : { width: 100, height: (FRAME / ratio) * 100 };
  const box = ratio >= THUMB ? { width: (image.height * THUMB) / FRAME, height: image.height } : { width: image.width, height: (image.width * FRAME) / THUMB };
  return { width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 };
}
