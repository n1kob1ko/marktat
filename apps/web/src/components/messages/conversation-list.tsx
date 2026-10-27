'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon } from 'lucide-react';
import type { ConversationSummary, RealtimeEvent } from '@marktat/shared';
import { cn } from '@marktat/ui';
import { formatListTime } from '@/lib/chat-format';
import { useRealtime } from '@/lib/realtime';

interface ConversationListProps {
  initial: ConversationSummary[];
  activeId?: string;
  /** Filter und Suche, die beim Öffnen einer Unterhaltung erhalten bleiben */
  query: string;
}

/** Postfach-Liste; neue Nachrichten verschieben die Unterhaltung live nach oben. */
export function ConversationList({ initial, activeId, query }: ConversationListProps) {
  const [items, setItems] = useState(initial);
  const router = useRouter();
  const refreshing = useRef(false);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'message') {
        const { message } = event;
        setItems((current) => {
          const index = current.findIndex((item) => item.id === message.conversationId);
          if (index < 0) {
            // Neue Unterhaltung: Liste vom Server holen (einmal, auch bei mehreren Nachrichten)
            if (!refreshing.current) {
              refreshing.current = true;
              setTimeout(() => {
                refreshing.current = false;
                router.refresh();
              }, 300);
            }
            return current;
          }
          const item = current[index]!;
          const updated: ConversationSummary = {
            ...item,
            lastMessage: { body: message.body.slice(0, 140), mine: message.mine, createdAt: message.createdAt },
            lastMessageAt: message.createdAt,
            unreadCount: message.mine || item.id === activeId ? item.unreadCount : item.unreadCount + 1,
          };
          return [updated, ...current.slice(0, index), ...current.slice(index + 1)];
        });
      } else if (event.type === 'read' && event.byMe) {
        setItems((current) => current.map((item) => (item.id === event.conversationId ? { ...item, unreadCount: 0 } : item)));
      }
    },
    [activeId, router],
  );
  useRealtime(onEvent);

  return (
    <ul className="divide-y divide-line" aria-label="Unterhaltungen">
      {items.map((item) => (
        <li key={item.id}>
          <ConversationItem item={item} active={item.id === activeId} href={`/nachrichten/${item.id}${query ? `?${query}` : ''}`} />
        </li>
      ))}
    </ul>
  );
}

function ConversationItem({ item, active, href }: { item: ConversationSummary; active: boolean; href: string }) {
  const unread = item.unreadCount > 0 && !active;
  const preview = item.lastMessage ? `${item.lastMessage.mine ? 'Du: ' : ''}${item.lastMessage.body.replace(/\s+/g, ' ')}` : '';
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex gap-3 px-4 py-3.5 transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none',
        active && 'bg-brand-50 hover:bg-brand-50',
      )}
      data-testid="conversation-item"
    >
      <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-canvas">
        {item.listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vorschaubild ist serverseitig optimiert
          <img src={item.listing.imageUrl} alt="" className={cn('size-full object-cover', !item.listing.available && 'opacity-50 grayscale')} loading="lazy" />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageIcon className="size-5 text-ink-300" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[0.9375rem] text-ink-900', unread ? 'font-bold' : 'font-semibold')}>
            {item.partner.displayName}
          </span>
          <time dateTime={item.lastMessageAt} className={cn('shrink-0 text-xs', unread ? 'font-semibold text-brand-700' : 'text-ink-500')} suppressHydrationWarning>
            {formatListTime(item.lastMessageAt)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-500">
          {item.role === 'seller' ? 'Deine Anzeige: ' : ''}
          {item.listing.title}
          {!item.listing.available ? ' · nicht mehr online' : ''}
        </span>
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-semibold text-ink-900' : 'text-ink-600')}>{preview}</span>
          {unread ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[0.6875rem] font-bold text-ink-950">
              <span className="sr-only">Ungelesen: </span>
              {item.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
