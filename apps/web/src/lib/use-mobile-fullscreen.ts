'use client';

import { useEffect, type RefObject } from 'react';

/** Unterhalb davon (Tailwind lg) ist der Chat eine eigene Vollbild-Ansicht */
const MOBILE = '(max-width: 1023.98px)';

/** Elemente, in denen man am Handy weiter wischen darf (Nachrichtenliste, langes Textfeld) */
const TOUCH_SCROLL_ATTR = 'data-touch-scroll';

/**
 * Hält eine Vollbild-Ansicht am Handy genau im sichtbaren Bereich – auch wenn die Bildschirmtastatur offen ist.
 *
 * iOS schiebt beim Antippen eines Textfelds den sichtbaren Ausschnitt über die Seite (`visualViewport.offsetTop`)
 * und lässt die Seite dahinter (samt Fußzeile) weiter scrollen. Deshalb:
 * - die Seite dahinter festsetzen (`body` fixed), damit dort nichts mehr scrollen kann,
 * - Höhe und Position direkt am Element setzen, sobald sich der sichtbare Bereich ändert (ohne React-Render und
 *   ohne auf den nächsten Frame zu warten, sonst hinkt die Ansicht hinterher und springt),
 * - Wischen außerhalb der Nachrichtenliste abfangen, sonst verschiebt iOS bei offener Tastatur den Ausschnitt.
 */
export function useMobileFullscreen(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia(MOBILE);
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const body = document.body;
    let locked = false;
    let savedScroll = 0;

    const lock = () => {
      if (locked) return;
      locked = true;
      savedScroll = window.scrollY;
      root.style.overflow = 'hidden';
      Object.assign(body.style, { position: 'fixed', top: `-${savedScroll}px`, left: '0', right: '0', overflow: 'hidden' });
    };
    const unlock = () => {
      if (!locked) return;
      locked = false;
      root.style.removeProperty('overflow');
      for (const prop of ['position', 'top', 'left', 'right', 'overflow']) body.style.removeProperty(prop);
      window.scrollTo(0, savedScroll);
    };

    const place = () => {
      if (!media.matches) {
        unlock();
        el.style.removeProperty('height');
        el.style.removeProperty('transform');
        return;
      }
      lock();
      if (!viewport) return;
      el.style.height = `${viewport.height}px`;
      el.style.transform = viewport.offsetTop ? `translateY(${viewport.offsetTop}px)` : '';
    };

    // Wischen nur dort zulassen, wo wirklich etwas scrollt
    const onTouchMove = (event: TouchEvent) => {
      if (!media.matches) return;
      const area = (event.target as Element | null)?.closest<HTMLElement>(`[${TOUCH_SCROLL_ATTR}]`);
      if (area && area.scrollHeight > area.clientHeight) return;
      event.preventDefault();
    };

    place();
    media.addEventListener('change', place);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      media.removeEventListener('change', place);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      el.removeEventListener('touchmove', onTouchMove);
      el.style.removeProperty('height');
      el.style.removeProperty('transform');
      unlock();
    };
  }, [ref]);
}
