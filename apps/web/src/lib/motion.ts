'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Dauern in ms – passend zu den Werten in packages/ui/src/motion.css */
export const MOTION = {
  popExit: 144,
  modalExit: 176,
  sheetExit: 208,
  move: 240,
} as const;

export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hält ein Element nach dem Schließen noch so lange im Baum, bis es ausgeblendet ist.
 * `state` gehört als data-state ans Element (motion.css: .pop, .drop).
 */
export function usePresence(open: boolean, exitMs: number = MOTION.popExit): { present: boolean; state: 'open' | 'closed' } {
  const [present, setPresent] = useState(open);
  // Beim Öffnen sofort da – ohne Umweg über einen Effekt
  if (open && !present) setPresent(true);

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setPresent(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return { present: open || present, state: open ? 'open' : 'closed' };
}

/**
 * Gummiband: Je weiter man über das Ende hinauszieht, desto weniger gibt die Fläche nach.
 * `distance` ist der Weg des Fingers über die Grenze, `dimension` die Breite der Fläche.
 */
export function rubberBand(distance: number, dimension: number, constant = 0.55): number {
  if (distance <= 0 || dimension <= 0) return 0;
  return (distance * dimension * constant) / (dimension + constant * distance);
}

/** Wohin eine losgelassene Wischbewegung führt: -1 zurück, 1 weiter, 0 bleibt. Ein schneller Wisch reicht. */
export function swipeTarget(dx: number, elapsedMs: number, width: number): -1 | 0 | 1 {
  const distance = Math.abs(dx);
  const velocity = elapsedMs > 0 ? distance / elapsedMs : 0;
  if (distance < 8) return 0;
  if (distance > width * 0.25 || velocity > 0.35) return dx < 0 ? 1 : -1;
  return 0;
}

/**
 * Wegpunkte für eine Bewegung von (dx, dy) zurück auf (0, 0), leicht gebogen statt schnurgerade.
 * Zwei Elemente, die die Plätze tauschen, weichen einander so aus (die Bögen zeigen in entgegengesetzte Richtungen).
 */
export function arcKeyframes(dx: number, dy: number, steps = 6): Keyframe[] {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return [{ translate: '0px 0px' }, { translate: '0px 0px' }];
  const bulge = Math.min(28, distance * 0.18);
  // Kontrollpunkt: Mitte der Strecke, senkrecht zur Bewegung versetzt
  const cx = dx / 2 + (-dy / distance) * bulge * 2;
  const cy = dy / 2 + (dx / distance) * bulge * 2;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * dx + 2 * (1 - t) * t * cx;
    const y = (1 - t) * (1 - t) * dy + 2 * (1 - t) * t * cy;
    frames.push({ translate: `${x.toFixed(1)}px ${y.toFixed(1)}px`, offset: t });
  }
  return frames;
}

/**
 * Elemente mit data-flip-id gleiten an ihren neuen Platz, wenn sich die Reihenfolge ändert
 * (statt zu springen). `order` ist eine Kennung der aktuellen Reihenfolge, z. B. die IDs als Text.
 */
export function useFlip(container: RefObject<HTMLElement | null>, order: string) {
  const positions = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    const origin = host.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const reduced = prefersReducedMotion();
    for (const el of host.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = el.dataset.flipId;
      if (!id) continue;
      const rect = el.getBoundingClientRect();
      const position = { x: rect.left - origin.left, y: rect.top - origin.top };
      next.set(id, position);
      const previous = positions.current.get(id);
      if (!previous || reduced || typeof el.animate !== 'function') continue;
      const dx = previous.x - position.x;
      const dy = previous.y - position.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate(arcKeyframes(dx, dy), { duration: 320, easing: EASE_IN_OUT });
    }
    positions.current = next;
  }, [container, order]);
}
