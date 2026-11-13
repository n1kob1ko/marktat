'use client';

import { useRef, type PointerEvent, type RefObject } from 'react';
import { X } from 'lucide-react';
import { MOTION, sheetDismisses } from '@/lib/motion';

interface Drag {
  pointerId: number;
  startY: number;
  startedAt: number;
  dy: number;
}

/**
 * Kopf eines bildschirmfüllenden Menüs am Handy (Filter): Titel, Schließen-Knopf und ein Griff zum Wegwischen.
 *
 * Wegwischen: Den Kopf nach unten ziehen – das Menü folgt dem Finger ohne Verzögerung. Weit oder schnell genug
 * gezogen schließt es, sonst gleitet es zurück. Der Inhalt darunter scrollt wie gewohnt und wischt nichts weg.
 * Das umgebende Element braucht die Klasse `sheet` (motion.css).
 */
export function SheetHeader({
  title,
  closeLabel,
  onClose,
  closeRef,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const drag = useRef<Drag | null>(null);

  const sheetOf = (el: HTMLElement) => el.closest<HTMLElement>('.sheet');

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (drag.current || event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now(), dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const sheet = sheetOf(event.currentTarget);
    if (!current || !sheet || event.pointerId !== current.pointerId) return;
    current.dy = Math.max(0, event.clientY - current.startY);
    // Solange gehalten wird: keine Übergänge, das Menü klebt am Finger
    sheet.dataset.dragging = 'true';
    sheet.style.translate = `0 ${current.dy.toFixed(1)}px`;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    const sheet = sheetOf(event.currentTarget);
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (!sheet) return;
    delete sheet.dataset.dragging;
    const dismiss = !cancelled && sheetDismisses(current.dy, performance.now() - current.startedAt, sheet.clientHeight);
    if (!dismiss) {
      // Zurück an den Platz – der Übergang der Klasse `sheet` übernimmt
      sheet.style.removeProperty('translate');
      return;
    }
    sheet.style.translate = '0 100%';
    onClose();
    // Nach dem Ausblenden aufräumen, damit das Menü beim nächsten Öffnen wieder an seinem Platz erscheint
    setTimeout(() => sheet.style.removeProperty('translate'), MOTION.sheetExit + 40);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      data-testid="sheet-header"
      className="relative flex touch-none items-center justify-between border-b border-line px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 select-none lg:hidden"
    >
      {/* Griff: zeigt, dass sich das Menü nach unten wegwischen lässt */}
      <span aria-hidden="true" className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line-strong" />
      <h2 className="font-sans text-lg font-semibold tracking-normal">{title}</h2>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="press tap relative flex size-10 items-center justify-center rounded-xl text-ink-600 hover:bg-canvas"
        aria-label={closeLabel}
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
