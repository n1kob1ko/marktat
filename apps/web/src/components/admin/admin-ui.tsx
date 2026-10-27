import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card, cn, type BadgeTone } from '@marktat/ui';
import {
  APPEAL_STATUS_LABELS,
  DECISION_GROUND_LABELS,
  formatDateTime,
  MODERATION_ACTION_LABELS,
  REPORT_PRIORITY_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  USER_ROLE_LABELS,
  USER_STATUS_LABELS,
  type AdminDecision,
  type AppealStatus,
  type ModerationAction,
  type PersonRef,
  type ReportPriority,
  type ReportStatus,
  type UserRole,
  type UserStatus,
} from '@marktat/shared';

// ---------------------------------------------------------------------------
// Statusanzeigen: immer Text und Farbe, nie Farbe allein
// ---------------------------------------------------------------------------

const REPORT_STATUS_TONES: Record<ReportStatus, BadgeTone> = { OPEN: 'warning', IN_REVIEW: 'brand', RESOLVED: 'success', DISMISSED: 'neutral' };
export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return <Badge tone={REPORT_STATUS_TONES[status]}>{REPORT_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_TONES: Record<ReportPriority, BadgeTone> = { LOW: 'neutral', NORMAL: 'neutral', HIGH: 'warning', URGENT: 'danger' };
export function PriorityBadge({ priority }: { priority: ReportPriority }) {
  return <Badge tone={PRIORITY_TONES[priority]}>Priorität: {REPORT_PRIORITY_LABELS[priority]}</Badge>;
}

const USER_STATUS_TONES: Record<UserStatus, BadgeTone> = { ACTIVE: 'success', SUSPENDED: 'danger', DELETED: 'neutral' };
export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={USER_STATUS_TONES[status]}>{USER_STATUS_LABELS[status]}</Badge>;
}

export function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'USER') return null;
  return <Badge tone="accent">{USER_ROLE_LABELS[role]}</Badge>;
}

const APPEAL_TONES: Record<AppealStatus, BadgeTone> = { OPEN: 'warning', UPHELD: 'neutral', REVERSED: 'success' };
export function AppealStatusBadge({ status }: { status: AppealStatus }) {
  return <Badge tone={APPEAL_TONES[status]}>Einspruch: {APPEAL_STATUS_LABELS[status]}</Badge>;
}

const ACTION_TONES: Record<ModerationAction, BadgeTone> = {
  LISTING_REJECTED: 'danger',
  LISTING_HIDDEN: 'warning',
  LISTING_RESTORED: 'success',
  ACCOUNT_SUSPENDED: 'danger',
  ACCOUNT_RESTORED: 'success',
  DEAL_REJECTED: 'danger',
  DEAL_HIDDEN: 'warning',
  DEAL_RESTORED: 'success',
  DEALS_BLOCKED: 'danger',
  DEALS_UNBLOCKED: 'success',
  SERVICE_PROFILE_REJECTED: 'danger',
  SERVICE_PROFILE_HIDDEN: 'warning',
  SERVICE_PROFILE_RESTORED: 'success',
  PORTFOLIO_ITEM_HIDDEN: 'warning',
  PORTFOLIO_ITEM_RESTORED: 'success',
};
export function ActionBadge({ action }: { action: ModerationAction }) {
  return <Badge tone={ACTION_TONES[action]}>{MODERATION_ACTION_LABELS[action]}</Badge>;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="font-sans text-xl font-bold tracking-normal text-ink-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Kennzahl; mit `href` führt sie zur passenden gefilterten Liste. */
export function StatCard({ label, value, hint, href, tone = 'neutral' }: { label: string; value: number | string; hint?: string; href?: string; tone?: 'neutral' | 'attention' }) {
  const content = (
    <>
      <p className="text-sm font-medium text-ink-600">{label}</p>
      <p className={cn('mt-1 font-display text-3xl font-bold tabular-nums', tone === 'attention' && Number(value) > 0 ? 'text-danger-700' : 'text-ink-950')}>
        {typeof value === 'number' ? value.toLocaleString('de-AT') : value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand-300">
      {content}
    </Link>
  ) : (
    <Card className="p-4">{content}</Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center text-sm text-ink-500">{children}</p>;
}

export function Section({ title, children, className, actions }: { title: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <Card className={cn('p-4 sm:p-6', className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-sans text-base font-semibold tracking-normal text-ink-950">{title}</h3>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Personen verlinken auf ihre Kontoseite; gelöschte Konten haben keinen Namen mehr. */
export function PersonLink({ person, fallback = '–' }: { person: PersonRef | null; fallback?: string }) {
  if (!person) return <span className="text-ink-500">{fallback}</span>;
  return (
    <Link href={`/admin/nutzer/${person.id}`} className="font-medium text-brand-700 hover:underline">
      {person.displayName}
    </Link>
  );
}

/**
 * Tabelle, die auf schmalen Bildschirmen zu Karten wird: Kopfzeile ausgeblendet, jede Zeile ein Block,
 * Zellen mit `data-label` zeigen ihre Spaltenbeschriftung davor.
 */
export const table = {
  wrapper: 'overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]',
  table: 'w-full text-left text-sm',
  head: 'hidden border-b border-line bg-canvas text-xs font-semibold tracking-wide text-ink-600 uppercase md:table-header-group',
  th: 'px-4 py-3 font-semibold',
  row: 'block border-b border-line px-4 py-3 last:border-b-0 md:table-row md:p-0 md:hover:bg-canvas/60',
  td: 'flex gap-2 py-1 align-top md:table-cell md:px-4 md:py-3 before:w-28 before:shrink-0 before:text-ink-500 before:content-[attr(data-label)] md:before:hidden',
  /** Erste Zelle: auf dem Handy ohne Beschriftung als Überschrift der Karte */
  tdMain: 'block py-1 align-top md:table-cell md:px-4 md:py-3',
};

export function DecisionList({ decisions, showUser = false }: { decisions: AdminDecision[]; showUser?: boolean }) {
  if (!decisions.length) return <p className="text-sm text-ink-500">Noch keine Entscheidungen.</p>;
  return (
    <ol className="space-y-4">
      {decisions.map((d) => (
        <li key={d.id} className={cn('rounded-xl border border-line p-4', d.reversed && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <ActionBadge action={d.action} />
            {d.reversed ? <Badge>Aufgehoben</Badge> : null}
            {d.appeal ? <AppealStatusBadge status={d.appeal.status} /> : null}
            <span className="text-xs text-ink-500">{formatDateTime(d.createdAt)}</span>
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
            {showUser ? (
              <>
                <dt className="text-ink-500">Betroffen</dt>
                <dd><PersonLink person={d.user} /></dd>
              </>
            ) : null}
            {d.listing ? (
              <>
                <dt className="text-ink-500">Inserat</dt>
                <dd>
                  <Link href={`/admin/inserate/${d.listing.id}`} className="text-brand-700 hover:underline">{d.listing.title}</Link>
                </dd>
              </>
            ) : null}
            {d.deal ? (
              <>
                <dt className="text-ink-500">Deal</dt>
                <dd>
                  <Link href={`/admin/deals/${d.deal.id}`} className="text-brand-700 hover:underline">{d.deal.title}</Link>
                </dd>
              </>
            ) : null}
            {d.serviceProfile ? (
              <>
                <dt className="text-ink-500">Anbieterprofil</dt>
                <dd>
                  <Link href={`/admin/dienstleistungen/${d.serviceProfile.id}`} className="text-brand-700 hover:underline">{d.serviceProfile.title}</Link>
                  {typeof d.snapshot?.portfolioItemId === 'string' && typeof d.snapshot.title === 'string' ? (
                    <span className="text-ink-600"> · Portfolio-Eintrag „{d.snapshot.title}“</span>
                  ) : null}
                </dd>
              </>
            ) : null}
            <dt className="text-ink-500">Entschieden von</dt>
            <dd><PersonLink person={d.moderator} fallback="System / Kommandozeile" /></dd>
            {d.reason ? (
              <>
                <dt className="text-ink-500">Verstoß</dt>
                <dd>{REPORT_REASON_LABELS[d.reason]}</dd>
              </>
            ) : null}
            {d.ground ? (
              <>
                <dt className="text-ink-500">Grundlage</dt>
                <dd>{DECISION_GROUND_LABELS[d.ground]}</dd>
              </>
            ) : null}
            <dt className="text-ink-500">Begründung</dt>
            <dd className="whitespace-pre-line text-ink-800">{d.statement}</dd>
            {d.internalNote ? (
              <>
                <dt className="text-ink-500">Interne Notiz</dt>
                <dd className="whitespace-pre-line text-ink-700">{d.internalNote}</dd>
              </>
            ) : null}
          </dl>
          {d.appeal ? (
            <div className="mt-3 rounded-lg bg-canvas p-3 text-sm">
              <p className="font-semibold text-ink-900">Einspruch vom {formatDateTime(d.appeal.createdAt)}</p>
              <p className="mt-1 whitespace-pre-line text-ink-700">{d.appeal.body}</p>
              {d.appeal.response ? <p className="mt-2 whitespace-pre-line text-ink-700"><span className="font-semibold">Antwort:</span> {d.appeal.response}</p> : null}
              {d.appeal.status === 'OPEN' ? (
                <Link href={`/admin/einsprueche/${d.appeal.id}`} className="mt-2 inline-block font-semibold text-brand-700 hover:underline">Einspruch prüfen</Link>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Filterleiste: ein einfaches GET-Formular, funktioniert auch ohne JavaScript. */
export function FilterBar({ action, children }: { action: string; children: ReactNode }) {
  return (
    <form action={action} method="get" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end">
      {children}
      <button type="submit" className="h-11 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
        Filtern
      </button>
    </form>
  );
}

export function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: { value: string; label: string }[] }) {
  const id = `filter-${name}`;
  return (
    <div className="space-y-1 sm:min-w-40">
      <label htmlFor={id} className="block text-xs font-semibold text-ink-700">{label}</label>
      <select id={id} name={name} defaultValue={value ?? ''} className="select-chevron block h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink-900 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function FilterSearch({ name = 'q', label, value, placeholder }: { name?: string; label: string; value?: string; placeholder?: string }) {
  const id = `filter-${name}`;
  return (
    <div className="flex-1 space-y-1 sm:min-w-56">
      <label htmlFor={id} className="block text-xs font-semibold text-ink-700">{label}</label>
      <input id={id} name={name} type="search" defaultValue={value} placeholder={placeholder} maxLength={100} className="block h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 focus:outline-none" />
    </div>
  );
}
