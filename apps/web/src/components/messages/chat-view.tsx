'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, Check, CheckCheck, ImageIcon, Info, RotateCw, SendHorizontal, ShieldAlert } from 'lucide-react';
import { MESSAGE_MAX_LENGTH, formatPriceCents, type ChatMessage, type ConversationDetail, type MessagePage, type RealtimeEvent } from '@marktat/shared';
import { Button, Spinner, cn } from '@marktat/ui';
import { dayKey, formatDayLabel, formatMessageTime } from '@/lib/chat-format';
import { setUnread, useRealtime } from '@/lib/realtime';
import { newClientId } from '@/lib/client-id';
import { loadMessagesAction, markReadAction, sendMessageAction } from '@/app/nachrichten/actions';
import { ChatMenu } from './chat-menu';

type LocalMessage = ChatMessage & { localId?: string; status?: 'sending' | 'failed'; error?: string };

const NEAR_BOTTOM_PX = 120;

interface ChatViewProps {
  conversation: ConversationDetail;
  initial: MessagePage;
  backHref: string;
}

/** Chatfenster: senden (optimistisch), live empfangen, ältere nachladen, Lesestatus. */
export function ChatView({ conversation, initial, backHref }: ChatViewProps) {
  const [messages, setMessages] = useState<LocalMessage[]>(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const keepOffset = useRef<number | null>(null);
  const stickToBottom = useRef(true);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = conversation.id;

  // --- Lesestatus ------------------------------------------------------------------
  const markRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await markReadAction(id).catch(() => null);
      if (result?.ok) setUnread(result.data);
    }, 400);
  }, [id]);

  useEffect(() => {
    if (conversation.unreadCount > 0) markRead();
    const onVisible = () => {
      if (document.visibilityState === 'visible') markRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [conversation.unreadCount, markRead]);

  // --- Scrollen ----------------------------------------------------------------------
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      // Ältere Nachrichten oben eingefügt: Position halten
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickToBottom.current = near;
    if (near) setShowJump(false);
  }

  // --- Echtzeit ------------------------------------------------------------------------
  const lastConfirmedId = useRef<string | null>(null);
  useEffect(() => {
    lastConfirmedId.current = [...messages].reverse().find((m) => !m.localId)?.id ?? null;
  }, [messages]);

  const append = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (!fresh.length) return current;
      // Bestätigte Nachrichten vor noch ausstehenden eigenen einsortieren
      const confirmed = current.filter((m) => !m.localId);
      const pending = current.filter((m) => m.localId);
      return [...confirmed, ...fresh, ...pending];
    });
  }, []);

  const onEvent = useCallback(
    async (event: RealtimeEvent) => {
      if (event.type === 'message' && event.message.conversationId === id) {
        if (!stickToBottom.current && !event.message.mine) setShowJump(true);
        append([event.message]);
        if (!event.message.mine) markRead();
      } else if (event.type === 'read' && event.conversationId === id && !event.byMe) {
        setMessages((current) => current.map((m) => (m.mine && !m.readAt && !m.localId ? { ...m, readAt: event.readAt } : m)));
      } else if (event.type === 'ready' && lastConfirmedId.current) {
        // Nach einer Unterbrechung: verpasste Nachrichten nachholen
        const result = await loadMessagesAction(id, { after: lastConfirmedId.current }).catch(() => null);
        if (result?.ok && result.data.items.length) {
          append(result.data.items);
          if (result.data.items.some((m) => !m.mine)) markRead();
        }
      }
    },
    [append, id, markRead],
  );
  useRealtime(onEvent);

  // --- Ältere Nachrichten -----------------------------------------------------------------
  async function loadOlder() {
    const oldest = messages.find((m) => !m.localId);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    const result = await loadMessagesAction(id, { before: oldest.id }).catch(() => null);
    setLoadingOlder(false);
    if (!result?.ok) {
      setOlderError(result?.message ?? 'Ältere Nachrichten konnten nicht geladen werden.');
      return;
    }
    const el = scroller.current;
    keepOffset.current = el ? el.scrollHeight - el.scrollTop : null;
    setHasMore(result.data.hasMore);
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      return [...result.data.items.filter((m) => !known.has(m.id)), ...current];
    });
  }

  // --- Senden ------------------------------------------------------------------------------
  async function deliver(localId: string, body: string) {
    // localId ist zugleich die clientId: Wiederholen nach einem Fehler legt keine zweite Nachricht an
    const result = await sendMessageAction(id, body, localId).catch(() => null);
    setMessages((current) => {
      if (!result?.ok) {
        const error = result?.message ?? 'Nicht gesendet. Bitte prüfe deine Verbindung.';
        return current.map((m) => (m.localId === localId ? { ...m, status: 'failed', error } : m));
      }
      const sent = result.data;
      // Die Echtzeit-Meldung kann vor der Antwort eintreffen
      if (current.some((m) => m.id === sent.id)) return current.filter((m) => m.localId !== localId);
      const confirmed = current.filter((m) => !m.localId);
      const pending = current.filter((m) => m.localId && m.localId !== localId);
      return [...confirmed, sent, ...pending];
    });
  }

  function send(body: string) {
    const localId = newClientId();
    stickToBottom.current = true;
    setMessages((current) => [
      ...current,
      { id: `local-${localId}`, localId, conversationId: id, body, mine: true, createdAt: new Date().toISOString(), readAt: null, status: 'sending' },
    ]);
    void deliver(localId, body);
  }

  function retry(message: LocalMessage) {
    if (!message.localId) return;
    setMessages((current) => current.map((m) => (m.localId === message.localId ? { ...m, status: 'sending', error: undefined } : m)));
    void deliver(message.localId, message.body);
  }

  const lastOwnConfirmed = [...messages].reverse().find((m) => m.mine && !m.localId);
  const { listing, partner, subject } = conversation;
  const price = !listing ? null : listing.priceType === 'FREE' ? 'Zu verschenken' : listing.priceCents !== null ? formatPriceCents(listing.priceCents) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas/40">
      {/* Kopf: Person und Anzeige */}
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <Link href={backHref} className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-900/5 lg:hidden" aria-label="Zurück zu allen Nachrichten">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <Link href={subject.href} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl hover:opacity-90">
          <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-canvas">
            {subject.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert
              <img src={subject.imageUrl} alt="" className={cn('size-full object-cover', !subject.available && 'opacity-50 grayscale')} />
            ) : (
              <span className="flex size-full items-center justify-center">
                <ImageIcon className="size-5 text-ink-300" aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink-900" data-testid="chat-partner">
              {partner.displayName}
            </span>
            <span className="block truncate text-xs text-ink-500">
              {subject.kind === 'service' ? 'Anbieterprofil: ' : ''}
              {subject.title}
              {price ? ` · ${price}` : ''}
            </span>
          </span>
        </Link>
        <ChatMenu conversation={conversation} />
      </header>

      {!subject.available ? (
        <p className="flex items-center gap-2 border-b border-line bg-warning-50 px-4 py-2 text-sm text-warning-700">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {subject.kind === 'service' ? 'Dieses Anbieterprofil ist nicht mehr online.' : 'Diese Anzeige ist nicht mehr online.'} Ihr könnt trotzdem weiterschreiben.
        </p>
      ) : null}

      {/* Verlauf */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Unterhaltung mit ${partner.displayName}`}
          data-testid="chat-log"
        >
          {hasMore ? (
            <div className="mb-4 flex flex-col items-center gap-1">
              <Button variant="ghost" size="sm" onClick={loadOlder} loading={loadingOlder}>
                Ältere Nachrichten laden
              </Button>
              {olderError ? <p className="text-xs text-danger-600">{olderError}</p> : null}
            </div>
          ) : (
            <p className="mx-auto mb-5 flex max-w-md items-start gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-ink-600 ring-1 ring-line">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden="true" />
              Sicher handeln: Zahle nie im Voraus an Unbekannte, gib keine Codes weiter und triff dich an belebten Orten.
            </p>
          )}

          <ol className="space-y-1.5">
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
              const grouped = previous && !newDay && previous.mine === message.mine;
              return (
                <Fragment key={message.localId ?? message.id}>
                  {newDay ? (
                    <li className="flex justify-center py-3" aria-hidden="false">
                      <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-500 ring-1 ring-line" suppressHydrationWarning>
                        {formatDayLabel(message.createdAt)}
                      </span>
                    </li>
                  ) : null}
                  <MessageBubble message={message} grouped={Boolean(grouped)} showReceipt={message === lastOwnConfirmed} onRetry={retry} />
                </Fragment>
              );
            })}
          </ol>
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-700 px-3.5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-brand-800"
          >
            <ArrowDown className="size-4" aria-hidden="true" /> Neue Nachricht
          </button>
        ) : null}
      </div>

      {conversation.sendBlockedReason ? (
        <p className="border-t border-line bg-surface px-4 py-4 text-center text-sm text-ink-600" data-testid="send-blocked">
          {conversation.sendBlockedReason}
        </p>
      ) : (
        <Composer onSend={send} />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  grouped,
  showReceipt,
  onRetry,
}: {
  message: LocalMessage;
  grouped: boolean;
  showReceipt: boolean;
  onRetry: (message: LocalMessage) => void;
}) {
  const mine = message.mine;
  return (
    <li className={cn('flex flex-col', mine ? 'items-end' : 'items-start', !grouped && 'pt-2')} data-testid="chat-message" data-mine={mine ? 'ja' : 'nein'}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[70%]',
          mine ? 'rounded-br-md bg-brand-700 text-white' : 'rounded-bl-md bg-surface text-ink-900 ring-1 ring-line',
          message.status === 'sending' && 'opacity-70',
          message.status === 'failed' && 'bg-danger-50 text-danger-700 ring-1 ring-danger-600/30',
        )}
      >
        <span className="sr-only">{mine ? 'Du' : 'Nachricht'}, {formatMessageTime(message.createdAt)}: </span>
        {message.body}
        <span
          className={cn('ml-2 inline-flex translate-y-0.5 items-center gap-1 align-bottom text-[0.6875rem] whitespace-nowrap', mine && message.status !== 'failed' ? 'text-white/70' : 'text-ink-500')}
          aria-hidden="true"
          suppressHydrationWarning
        >
          {formatMessageTime(message.createdAt)}
          {mine && !message.localId ? message.readAt ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" /> : null}
          {message.status === 'sending' ? <Spinner className="size-3" /> : null}
        </span>
      </div>
      {message.status === 'failed' ? (
        <p className="mt-1 flex items-center gap-2 text-xs text-danger-600" role="alert">
          {message.error}
          <button type="button" onClick={() => onRetry(message)} className="inline-flex items-center gap-1 font-semibold underline">
            <RotateCw className="size-3" aria-hidden="true" /> Erneut senden
          </button>
        </p>
      ) : showReceipt ? (
        <p className="mt-1 text-[0.6875rem] text-ink-500" data-testid="read-receipt">
          {message.readAt ? 'Gelesen' : 'Zugestellt'}
        </p>
      ) : null}
    </li>
  );
}

function Composer({ onSend }: { onSend: (body: string) => void }) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const tooLong = value.length > MESSAGE_MAX_LENGTH;

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed || tooLong) return;
    onSend(value);
    setValue('');
    textarea.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Desktop: Enter sendet, Umschalt+Enter macht eine neue Zeile. Auf Touch-Geräten bleibt Enter ein Zeilenumbruch.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Nachricht schreiben
        </label>
        <textarea
          id="chat-input"
          ref={textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH + 200}
          placeholder="Nachricht schreiben …"
          aria-invalid={tooLong || undefined}
          aria-describedby={value.length > MESSAGE_MAX_LENGTH - 200 ? 'chat-counter' : undefined}
          className="block max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-canvas px-4 py-2.5 text-[0.9375rem] leading-normal placeholder:text-ink-400 focus:border-brand-500 focus:bg-surface focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
        />
        <Button type="submit" className="size-11 shrink-0 rounded-full px-0" disabled={!trimmed || tooLong} aria-label="Senden">
          <SendHorizontal className="size-5" aria-hidden="true" />
        </Button>
      </div>
      {value.length > MESSAGE_MAX_LENGTH - 200 ? (
        <p id="chat-counter" className={cn('mt-1 text-right text-xs', tooLong ? 'font-semibold text-danger-600' : 'text-ink-500')}>
          {value.length.toLocaleString('de-AT')} / {MESSAGE_MAX_LENGTH.toLocaleString('de-AT')} Zeichen
        </p>
      ) : null}
    </form>
  );
}
