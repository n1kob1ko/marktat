import Link from 'next/link';
import { Inbox, Search } from 'lucide-react';
import type { ConversationSummary, Paginated } from '@marktat/shared';
import { buttonClasses, cn } from '@marktat/ui';
import { api } from '@/lib/api';
import { ConversationList } from './conversation-list';

export const INBOX_FILTERS = [
  { value: 'alle', label: 'Alle' },
  { value: 'ungelesen', label: 'Ungelesen' },
  { value: 'kaufen', label: 'Kaufen' },
  { value: 'verkaufen', label: 'Verkaufen' },
] as const;
type InboxFilter = (typeof INBOX_FILTERS)[number]['value'];

export interface InboxParams {
  filter: InboxFilter;
  q: string;
  page: number;
}

export function parseInboxParams(params: Record<string, string | string[] | undefined>): InboxParams {
  const filter = INBOX_FILTERS.find((f) => f.value === params.filter)?.value ?? 'alle';
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const page = Math.min(Math.max(Number.parseInt(typeof params.seite === 'string' ? params.seite : '1', 10) || 1, 1), 50);
  return { filter, q, page };
}

function inboxQuery({ filter, q, page }: Partial<InboxParams>): string {
  const params = new URLSearchParams();
  if (filter && filter !== 'alle') params.set('filter', filter);
  if (q) params.set('q', q);
  if (page && page > 1) params.set('seite', String(page));
  return params.toString();
}

/** Linke Spalte: Filter, Suche und Liste der Unterhaltungen */
export async function InboxPanel({ token, params, activeId }: { token: string; params: InboxParams; activeId?: string }) {
  let result: Paginated<ConversationSummary> | null = null;
  try {
    const query = new URLSearchParams({ filter: params.filter, seite: String(params.page), ...(params.q ? { q: params.q } : {}) });
    result = await api<Paginated<ConversationSummary>>(`/conversations?${query}`, { token, cache: 'no-store' });
  } catch {
    result = null;
  }
  const base = activeId ? `/nachrichten/${activeId}` : '/nachrichten';
  const keepQuery = inboxQuery({ filter: params.filter, q: params.q });
  const filtered = params.filter !== 'alle' || params.q;
  const hasMore = result ? result.page * result.pageSize < result.total : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold text-ink-950">Nachrichten</h1>
        <form action={base} role="search" className="relative">
          {params.filter !== 'alle' ? <input type="hidden" name="filter" value={params.filter} /> : null}
          <label htmlFor="inbox-search" className="sr-only">
            Unterhaltungen durchsuchen
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            id="inbox-search"
            name="q"
            type="search"
            defaultValue={params.q}
            maxLength={100}
            placeholder="Name oder Anzeige suchen"
            className="h-10 w-full rounded-xl border border-line-strong bg-canvas pr-3 pl-9 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:bg-surface focus:ring-3 focus:ring-brand-500/20 focus:outline-none"
          />
        </form>
        <nav aria-label="Unterhaltungen filtern" className="-mx-1 flex gap-1 overflow-x-auto">
          {INBOX_FILTERS.map((f) => {
            const query = inboxQuery({ filter: f.value, q: params.q });
            const current = params.filter === f.value;
            return (
              <Link
                key={f.value}
                href={`${base}${query ? `?${query}` : ''}`}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
                  current ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-900/5 hover:text-ink-900',
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!result ? (
          <div className="p-6 text-center text-sm text-ink-600" role="alert">
            Deine Nachrichten konnten gerade nicht geladen werden.{' '}
            <Link href={`${base}${keepQuery ? `?${keepQuery}` : ''}`} className="font-semibold text-brand-700 hover:underline">
              Erneut versuchen
            </Link>
          </div>
        ) : result.items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Inbox className="size-8 text-ink-300" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink-900">{filtered ? 'Keine passenden Unterhaltungen' : 'Noch keine Nachrichten'}</p>
            <p className="mt-1 max-w-xs text-sm text-ink-500">
              {filtered
                ? 'Ändere den Filter oder den Suchbegriff.'
                : 'Schreib Anbietern direkt auf der Anzeige – eure Unterhaltungen erscheinen dann hier.'}
            </p>
            {filtered ? (
              <Link href={base} className={buttonClasses({ variant: 'outline', size: 'sm', className: 'mt-4' })}>
                Alle Unterhaltungen zeigen
              </Link>
            ) : (
              <Link href="/suche" className={buttonClasses({ variant: 'outline', size: 'sm', className: 'mt-4' })}>
                Anzeigen entdecken
              </Link>
            )}
          </div>
        ) : (
          <>
            <ConversationList
              key={result.items.map((i) => `${i.id}:${i.lastMessageAt}:${i.unreadCount}`).join('|')}
              initial={result.items}
              activeId={activeId}
              query={keepQuery}
            />
            {hasMore || params.page > 1 ? (
              <div className="flex justify-between gap-2 border-t border-line p-3">
                {params.page > 1 ? (
                  <Link href={`${base}?${inboxQuery({ ...params, page: params.page - 1 })}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    Neuere
                  </Link>
                ) : (
                  <span />
                )}
                {hasMore ? (
                  <Link href={`${base}?${inboxQuery({ ...params, page: params.page + 1 })}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    Ältere Unterhaltungen
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
