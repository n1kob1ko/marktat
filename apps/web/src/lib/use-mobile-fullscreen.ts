'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/** Unterhalb davon (Tailwind lg) ist der Chat eine eigene Vollbild-Ansicht */
const MOBILE = '(max-width: 1023.98px)';

/**
 * Hält eine Vollbild-Ansicht am Handy genau im sichtbaren Bereich – auch wenn die Bildschirmtastatur offen ist.
 *
 * Ohne das schiebt der Browser beim Antippen des Textfelds die ganze Seite nach oben (iOS) bzw. die Tastatur
 * verdeckt das Feld (Android), und hinter dem Chat scrollt die restliche Seite samt Fußzeile mit. Deshalb: Seite
 * dahinter sperren und Höhe/Position an `visualViewport` (der Teil über der Tastatur) anpassen.
 */
export function useMobileFullscreen(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => {
    const media = window.matchMedia(MOBILE);
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!media.matches) {
          setStyle(undefined);
          root.style.removeProperty('overflow');
          return;
        }
        root.style.overflow = 'hidden';
        setStyle(viewport ? { top: viewport.offsetTop, height: viewport.height } : undefined);
      });
    };

    update();
    media.addEventListener('change', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('change', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      root.style.removeProperty('overflow');
    };
  }, []);

  return style;
}
