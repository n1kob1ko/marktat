/**
 * Kurze Hinweise am unteren Bildschirmrand (components/toaster.tsx zeigt sie an).
 *
 * `undoable` ist der Ersatz für „Bist du sicher?“: Die Änderung ist sofort zu sehen, wird aber erst nach Ablauf
 * des Hinweises wirklich ausgeführt. „Rückgängig“ (oder Strg+Z) nimmt sie in dieser Zeit zurück.
 * Es gibt immer nur einen Hinweis; ein neuer schließt den alten ab (dessen Änderung wird dann sofort ausgeführt).
 */
export interface Toast {
  id: number;
  message: string;
  tone: 'neutral' | 'danger';
  /** Beschriftung des Knopfs, z. B. „Rückgängig“ */
  actionLabel?: string;
  /** Sichtbarkeit in ms (ohne Zeiten, in denen der Zeiger darauf ruht) */
  duration: number;
}

interface Entry extends Toast {
  onAction?: () => void;
  /** Läuft, wenn der Hinweis ohne Klick auf den Knopf endet (abgelaufen, ersetzt, Seite verlassen) */
  onSettle?: () => void;
}

export const TOAST_DURATION = 5000;
export const UNDO_DURATION = 7000;

let current: Entry | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToast(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentToast(): Toast | null {
  return current;
}

/** Hinweis endet ohne Klick: ausstehende Änderung jetzt ausführen */
export function settleToast(id?: number) {
  const entry = current;
  if (!entry || (id !== undefined && entry.id !== id)) return;
  current = null;
  emit();
  entry.onSettle?.();
}

/** Klick auf den Knopf des Hinweises (oder Strg+Z) */
export function runToastAction(id?: number) {
  const entry = current;
  if (!entry || (id !== undefined && entry.id !== id) || !entry.onAction) return;
  current = null;
  emit();
  entry.onAction();
}

export function showToast(options: {
  message: string;
  tone?: Toast['tone'];
  actionLabel?: string;
  onAction?: () => void;
  onSettle?: () => void;
  duration?: number;
}): number {
  settleToast();
  const id = nextId++;
  current = {
    id,
    message: options.message,
    tone: options.tone ?? 'neutral',
    actionLabel: options.onAction ? (options.actionLabel ?? 'Rückgängig') : undefined,
    duration: options.duration ?? (options.onAction ? UNDO_DURATION : TOAST_DURATION),
    onAction: options.onAction,
    onSettle: options.onSettle,
  };
  emit();
  return id;
}

/**
 * Änderung mit Bedenkzeit: `commit` läuft genau einmal, sobald der Hinweis ohne „Rückgängig“ endet –
 * auch wenn die Seite vorher verlassen oder ein neuer Hinweis gezeigt wird. `undo` stellt die Anzeige wieder her.
 */
export function undoable(options: { message: string; commit: () => void; undo: () => void; undoLabel?: string }): number {
  return showToast({ message: options.message, actionLabel: options.undoLabel, onAction: options.undo, onSettle: options.commit });
}
