'use client';

import { useLayoutEffect, useRef } from 'react';
import { cn } from '@marktat/ui';
import { EASE_IN_OUT, MOTION, prefersReducedMotion } from '@/lib/motion';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Letzte Position je Leiste – damit die Markierung auch dann gleitet, wenn die Seite die Leiste neu aufbaut */
const memory = new Map<string, Box>();

/**
 * Markierung des aktiven Eintrags, die beim Wechsel zum neuen Eintrag hinübergleitet (ein und dasselbe Element,
 * statt am alten Platz zu verschwinden und am neuen aufzutauchen). Unterwegs streckt sie sich um 12 % in Fahrtrichtung.
 *
 * Gehört als erstes Kind in einen Behälter mit `relative` und der Klasse `group/nav`; sie sucht darin den Eintrag mit
 * aria-current. Sobald sie steht, setzt sie data-indicator am Behälter – die Einträge blenden dann ihre eigene
 * Markierung aus (`group-data-[indicator]/nav:…`). Ohne JavaScript bleibt die Markierung am Eintrag selbst sichtbar.
 */
export function SlidingIndicator({
  watch,
  id,
  axis = 'x',
  as: Tag = 'span',
  className,
}: {
  /** Kennung des aktiven Eintrags; bei jeder Änderung wird neu gemessen */
  watch: string | null;
  /** Name der Leiste, falls sie beim Seitenwechsel neu aufgebaut wird (z. B. Reiter, die über die Adresse umschalten) */
  id?: string;
  axis?: 'x' | 'y';
  /** In einer Liste (<ul>) als <li>, damit das HTML gültig bleibt */
  as?: 'span' | 'li';
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const last = useRef<Box | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;

    const place = (animate: boolean) => {
      const target = host.querySelector<HTMLElement>('[aria-current="page"], [aria-current="true"]');
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0) {
        el.style.opacity = '0';
        last.current = null;
        return;
      }
      const origin = host.getBoundingClientRect();
      const next: Box = {
        x: rect.left - origin.left + host.scrollLeft - host.clientLeft,
        y: rect.top - origin.top + host.scrollTop - host.clientTop,
        w: rect.width,
        h: rect.height,
      };
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
      el.style.translate = `${next.x}px ${next.y}px`;
      el.style.opacity = '1';
      host.setAttribute('data-indicator', '');

      const previous = last.current ?? (id ? (memory.get(id) ?? null) : null);
      last.current = next;
      if (id) memory.set(id, next);
      if (!animate || !previous || prefersReducedMotion() || typeof el.animate !== 'function') return;
      // Weg der Mittelpunkte; die Markierung steht schon am Ziel und wird von der alten Stelle her „zurückgespielt“
      const dx = previous.x + previous.w / 2 - (next.x + next.w / 2);
      const dy = previous.y + previous.h / 2 - (next.y + next.h / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(previous.w - next.w) < 1) return;
      const sx = previous.w / next.w;
      const sy = previous.h / next.h;
      const stretch = 1.12;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          {
            transform: `translate(${dx / 2}px, ${dy / 2}px) scale(${((sx + 1) / 2) * (axis === 'x' ? stretch : 1)}, ${((sy + 1) / 2) * (axis === 'y' ? stretch : 1)})`,
            offset: 0.5,
          },
          { transform: 'translate(0, 0) scale(1, 1)' },
        ],
        { duration: MOTION.move, easing: EASE_IN_OUT },
      );
    };

    place(true);
    // Breite ändert sich (Drehen des Geräts, Schrift geladen): ohne Bewegung nachführen
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place(false));
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [watch, axis, id]);

  return (
    <Tag
      ref={ref as never}
      aria-hidden="true"
      role={Tag === 'li' ? 'presentation' : undefined}
      className={cn('indicator', className)}
      style={{ opacity: 0 }}
    />
  );
}
