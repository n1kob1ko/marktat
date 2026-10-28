import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, Eye } from 'lucide-react';
import { Badge, buttonClasses, Select, Skeleton, Textarea } from '@marktat/ui';
import {
  formatDate,
  formatDateTime,
  REPORT_PRIORITIES,
  REPORT_PRIORITY_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_LABELS,
  type AdminReportDetail,
  type ReportEventItem,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ENTITY_ID, param } from '@/lib/admin';
import { SubmitButton } from '@/components/submit-button';
import { DecisionList, PersonLink, PriorityBadge, ReportStatusBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { ActionForm, DismissReportForm } from '@/components/admin/forms';
import { updateReportAction } from '../../actions';

export const metadata: Metadata = { title: 'Meldung' };

export default function ReportDetailPage({ params, searchParams }: PageProps<'/admin/meldungen/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <ReportDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportDetail({ params, searchParams }: Pick<PageProps<'/admin/meldungen/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/meldungen/${id}`);
  let report: AdminReportDetail;
  try {
    report = await api<AdminReportDetail>(`/admin/reports/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const open = report.status === 'OPEN' || report.status === 'IN_REVIEW';
  const mine = report.assignee?.id === user.id;

  return (
    <div className="space-y-6">
      <Link href="/admin/meldungen" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Meldungen
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ReportStatusBadge status={report.status} />
          <PriorityBadge priority={report.priority} />
          <Badge>{REPORT_TARGET_LABELS[report.targetType]}</Badge>
          {report.abusive ? <Badge tone="danger">Offensichtlich unbegründet</Badge> : null}
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal text-ink-950">{REPORT_REASON_LABELS[report.reason]}</h2>
        <p className="text-sm text-ink-500">Eingegangen am {formatDateTime(report.createdAt)}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Section title="Inhalt der Meldung">
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-ink-500">Gemeldet</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <PersonLink person={report.reported} fallback="Gelöschtes Konto" />
                {report.reported ? <UserStatusBadge status={report.reported.status} /> : null}
              </dd>
              {report.listing ? (
                <>
                  <dt className="text-ink-500">Inserat</dt>
                  <dd>
                    <Link href={`/admin/inserate/${report.listing.id}`} className="font-medium text-brand-700 hover:underline">{report.listing.title}</Link>
                  </dd>
                </>
              ) : null}
              {report.deal ? (
                <>
                  <dt className="text-ink-500">Deal</dt>
                  <dd>
                    <Link href={`/admin/deals/${report.deal.id}`} className="font-medium text-brand-700 hover:underline">{report.deal.title}</Link>
                  </dd>
                </>
              ) : null}
              {report.serviceProfile ? (
                <>
                  <dt className="text-ink-500">Anbieterprofil</dt>
                  <dd>
                    <Link href={`/admin/dienstleistungen/${report.serviceProfile.id}`} className="font-medium text-brand-700 hover:underline">{report.serviceProfile.title}</Link>
                  </dd>
                </>
              ) : null}
              {report.project ? (
                <>
                  <dt className="text-ink-500">Projektauftrag</dt>
                  <dd>
                    <Link href={`/admin/dienstleistungen/projekte/${report.project.id}`} className="font-medium text-brand-700 hover:underline">{report.project.title}</Link>
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-500">Begründung</dt>
              <dd className="whitespace-pre-line text-ink-800">{report.details || <span className="text-ink-500">Keine Angaben.</span>}</dd>
              <dt className="text-ink-500">Meldende Person</dt>
              <dd>
                <PersonLink person={report.reporter} fallback="Gelöschtes Konto" />
                {report.reporterStats ? (
                  <span className="block text-ink-500">
                    {report.reporterStats.total} Meldung(en), davon {report.reporterStats.abusive} offensichtlich unbegründet
                    {report.reporterStats.blockedUntil ? ` · Meldefunktion eingeschränkt bis ${formatDate(report.reporterStats.blockedUntil)}` : ''}
                  </span>
                ) : null}
              </dd>
              {report.handledAt ? (
                <>
                  <dt className="text-ink-500">Abgeschlossen</dt>
                  <dd>
                    {formatDateTime(report.handledAt)} von <PersonLink person={report.handledBy} />
                    {report.resolutionNote ? <span className="block whitespace-pre-line text-ink-700">{report.resolutionNote}</span> : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </Section>

          {report.targetType === 'CONVERSATION' ? (
            <Section title="Gemeldete Unterhaltung">
              <p className="text-sm text-ink-600">
                Private Nachrichten sind grundsätzlich nicht einsehbar. Für die Prüfung dieser Meldung kannst du die Nachrichten bis zum Zeitpunkt der Meldung öffnen – der Zugriff
                wird mit deinem Namen protokolliert.
              </p>
              {report.canViewMessages ? (
                <Link href={`/admin/meldungen/${report.id}/nachrichten`} className={buttonClasses({ variant: 'outline', size: 'sm', className: 'mt-3' })}>
                  <Eye className="size-4" aria-hidden="true" /> Nachrichten prüfen
                </Link>
              ) : (
                <p className="mt-2 text-sm text-ink-500">Die Meldung ist abgeschlossen, der Zugriff ist nicht mehr möglich.</p>
              )}
            </Section>
          ) : null}

          {report.decision ? (
            <Section title="Entscheidung">
              <DecisionList decisions={[report.decision]} showUser />
            </Section>
          ) : null}

          <Section title="Verlauf">
            <EventList events={report.events} />
          </Section>

          {report.related.length ? (
            <Section title={`Weitere Meldungen zum selben Inhalt (${report.related.length})`}>
              <ul className="divide-y divide-line text-sm">
                {report.related.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Link href={`/admin/meldungen/${r.id}`} className="font-medium text-brand-700 hover:underline">{REPORT_REASON_LABELS[r.reason]}</Link>
                    <ReportStatusBadge status={r.status} />
                    <span className="text-ink-500">{formatDateTime(r.createdAt)} · von {r.reporter?.displayName ?? 'Gelöschtes Konto'}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <aside className="space-y-4">
          {open ? (
            <>
              <Section title="Bearbeitung">
                <p className="mb-3 text-sm text-ink-600">
                  Zuständig: <PersonLink person={report.assignee} fallback="niemand" />
                </p>
                <ActionForm action={updateReportAction} className="space-y-3">
                  <input type="hidden" name="id" value={report.id} />
                  <input type="hidden" name="assign" value={mine ? 'none' : 'me'} />
                  <SubmitButton variant={mine ? 'outline' : 'primary'} size="sm">{mine ? 'Freigeben' : 'Übernehmen'}</SubmitButton>
                </ActionForm>
                <ActionForm action={updateReportAction} className="mt-4 space-y-2">
                  <input type="hidden" name="id" value={report.id} />
                  <label htmlFor="priority" className="block text-sm font-semibold text-ink-900">Priorität</label>
                  <div className="flex gap-2">
                    <Select id="priority" name="priority" defaultValue={report.priority} className="h-9 text-sm">
                      {REPORT_PRIORITIES.map((p) => (
                        <option key={p} value={p}>{REPORT_PRIORITY_LABELS[p]}</option>
                      ))}
                    </Select>
                    <SubmitButton variant="outline" size="sm">Ändern</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={updateReportAction} className="mt-4 space-y-2">
                  <input type="hidden" name="id" value={report.id} />
                  <label htmlFor="note" className="block text-sm font-semibold text-ink-900">Notiz zum Verlauf</label>
                  <Textarea id="note" name="note" rows={2} maxLength={1000} className="min-h-20" required />
                  <SubmitButton variant="outline" size="sm">Notiz speichern</SubmitButton>
                </ActionForm>
              </Section>

              <Section title="Entscheiden">
                <div className="space-y-3 text-sm">
                  {report.listing ? (
                    <Link href={`/admin/inserate/${report.listing.id}`} className={buttonClasses({ size: 'sm', className: 'w-full' })}>
                      Inserat prüfen und entscheiden
                    </Link>
                  ) : null}
                  {report.deal ? (
                    <Link href={`/admin/deals/${report.deal.id}`} className={buttonClasses({ size: 'sm', className: 'w-full' })}>
                      Deal prüfen und entscheiden
                    </Link>
                  ) : null}
                  {report.serviceProfile ? (
                    <Link href={`/admin/dienstleistungen/${report.serviceProfile.id}`} className={buttonClasses({ size: 'sm', className: 'w-full' })}>
                      Anbieterprofil prüfen und entscheiden
                    </Link>
                  ) : null}
                  {report.project ? (
                    <Link href={`/admin/dienstleistungen/projekte/${report.project.id}`} className={buttonClasses({ size: 'sm', className: 'w-full' })}>
                      Projektauftrag prüfen und entscheiden
                    </Link>
                  ) : null}
                  {report.reported && report.reported.status === 'ACTIVE' ? (
                    <Link href={`/admin/nutzer/${report.reported.id}?meldung=${report.id}`} className={buttonClasses({ variant: 'outline', size: 'sm', className: 'w-full' })}>
                      Konto prüfen
                    </Link>
                  ) : null}
                  <p className="text-ink-500">Liegt kein Verstoß vor, schließe die Meldung hier ab:</p>
                  <DismissReportForm id={report.id} />
                </div>
              </Section>
            </>
          ) : (
            <Section title="Abgeschlossen">
              <p className="text-sm text-ink-600">Status: {REPORT_STATUS_LABELS[report.status]}. Eine Änderung ist nur über eine neue Entscheidung oder einen Einspruch möglich.</p>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

const EVENT_LABELS: Record<ReportEventItem['type'], string> = {
  CREATED: 'Meldung eingegangen',
  ASSIGNED: 'Übernommen',
  UNASSIGNED: 'Freigegeben',
  PRIORITY_CHANGED: 'Priorität geändert',
  STATUS_CHANGED: 'Status geändert',
  NOTE: 'Notiz',
};

function EventList({ events }: { events: ReportEventItem[] }) {
  if (!events.length) return <p className="text-sm text-ink-500">Kein Verlauf.</p>;
  return (
    <ol className="space-y-3 border-l-2 border-line pl-4 text-sm">
      {events.map((e) => (
        <li key={e.id}>
          <p className="font-semibold text-ink-900">
            {EVENT_LABELS[e.type]}
            {e.toStatus ? <span className="font-normal text-ink-600"> → {REPORT_STATUS_LABELS[e.toStatus]}</span> : null}
          </p>
          <p className="text-ink-500">
            {formatDateTime(e.createdAt)} · {e.actor ? e.actor.displayName : 'System'}
          </p>
          {e.note ? <p className="mt-0.5 whitespace-pre-line text-ink-700">{e.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
