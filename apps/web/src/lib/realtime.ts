'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { RealtimeEvent, UnreadSummary } from '@marktat/shared';

/**
 * Eine Echtzeit-Verbindung je Browser-Tab (Server-Sent Events über /api/ereignisse), geteilt von Header,
 * Postfach und Chat. EventSource verbindet sich nach Unterbrechungen selbst neu; schlägt das endgültig fehl
 * (z. B. Server neu gestartet), versucht es dieser Client mit wachsendem Abstand erneut.
 */
type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();
const unreadListeners = new Set<() => void>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2_000;
let unread: UnreadSummary | null = null;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/ereignisse');
  source.onmessage = (message) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data) as RealtimeEvent;
    } catch {
      return;
    }
    retryDelay = 2_000;
    if ('unread' in event) setUnread(event.unread);
    for (const listener of listeners) listener(event);
  };
  source.onerror = () => {
    if (source?.readyState !== EventSource.CLOSED) return;
    source = null;
    if (!listeners.size) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (listeners.size) connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  };
}

function disconnect() {
  source?.close();
  source = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Ereignisse empfangen, solange die Komponente sichtbar ist. Gibt die Abmeldung zurück. */
export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    // Kurz offen lassen: beim Seitenwechsel meldet sich die nächste Komponente gleich wieder an
    setTimeout(() => {
      if (!listeners.size) disconnect();
    }, 1_000);
  };
}

export function useRealtime(listener: Listener) {
  useEffect(() => subscribeRealtime(listener), [listener]);
}

/** Ungelesen-Zähler, z. B. nach „gelesen“ ohne Umweg über den Server */
export function setUnread(value: UnreadSummary) {
  if (unread && unread.messages === value.messages && unread.conversations === value.conversations) return;
  unread = value;
  for (const listener of unreadListeners) listener();
}

/** Startwert vom Server, solange noch kein Ereignis da ist */
export function seedUnread(value: UnreadSummary) {
  if (!unread) setUnread(value);
}

function subscribeUnread(listener: () => void) {
  unreadListeners.add(listener);
  return () => unreadListeners.delete(listener);
}

/** Aktuelle Zahl ungelesener Nachrichten; `initial` kommt vom Server, bis die Verbindung steht. */
export function useUnread(initial: UnreadSummary | null = null): UnreadSummary | null {
  return useSyncExternalStore(
    subscribeUnread,
    () => unread ?? initial,
    () => initial,
  );
}

/** Beim An- oder Abmelden: Verbindung und Zähler des vorherigen Kontos verwerfen */
export function resetRealtime() {
  disconnect();
  unread = null;
  for (const listener of unreadListeners) listener();
  if (listeners.size) connect();
}
