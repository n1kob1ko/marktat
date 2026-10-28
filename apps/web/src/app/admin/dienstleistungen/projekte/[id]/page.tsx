import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Alert, Badge, Skeleton } from '@marktat/ui';
import { formatDate, formatDateTime, REPORT_REASON_LABELS, type AdminProjectDetail, type ServiceProjectStatus } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID, param } from '@/lib/admin';
import { projectBudgetLabel, projectExpired, projectPlaceLabel } from '@/lib/projects';
import { FlashMessage } from '@/components/flash-message';
import { ProjectStatusBadge } from '@/components/services/project-status-badge';
import { DecisionList, PersonLink, ReportStatusBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { DecisionForm, type DecisionOption } from '@/components/admin/forms';

export const metadata: Metadata = { title: 'Projektauftrag prüfen' };

/** Welche Entscheidung in welchem Status möglich ist (entspricht der Prüfung in der API) */
function decisionOptions(status: ServiceProjectStatus): DecisionOption[] {
  const options: DecisionOption[] = [];
  if (['ACTIVE', 'PAUSED', 'CLOSED', 'PENDING_REVIEW'].includes(status)) {
    options.push({
      value: 'REJECT',
      label: 'Deaktivieren',
      description: 'Verstoß festgestellt (z. B. verstecktes Arbeitsverhältnis, unbezahlte Probearbeit, Betrug). Der Auftrag verschwindet, offene Meldungen werden erledigt.',
      restrictive: true,
    });
  }
  if (['ACTIVE', 'PAUSED'].includes(status)) {
    options.push({ value: 'HIDE', label: 'Bis zur Prüfung ausblenden', description: 'Vorläufig: nicht mehr öffentlich, die Meldungen bleiben in Bearbeitung.', restrictive: true });
  }
  if (['REJECTED', 'PENDING_REVIEW'].includes(status)) {
    options.push({ value: 'RESTORE', label: 'Freigeben', description: 'Kein Verstoß (mehr). Der Auftrag ist wieder sichtbar.', restrictive: false });
  }
  return options;
}

export default function AdminProjectPage({ params, searchParams }: PageProps<'/admin/dienstleistungen/projekte/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <AdminProject params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminProject({ params, searchParams }: Pick<PageProps<'/admin/dienstleistungen/projekte/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!ENTITY_ID.test(id)) notFound();
  const { user, token } = await requireStaff(`/admin/dienstleistungen/projekte/${id}`);
  let detail: AdminProjectDetail;
  try {
    detail = await api<AdminProjectDetail>(`/admin/projects/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { project, client, decisions, reports } = detail;
  const openReports = reports.filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW');
  const own = client.id === user.id;
  const rows: [string, React.ReactNode][] = [
    ['Kategorie', project.category.name],
    ['Ort', projectPlaceLabel(project) || '–'],
    ['Budget', projectBudgetLabel(project)],
    ['Zeitraum', project.timeframe ?? '–'],
    ['Veröffentlicht', project.publishedAt ? formatDateTime(project.publishedAt) : 'noch nicht'],
    ['Läuft bis', project.expiresAt ? formatDateTime(project.expiresAt) : '–'],
    ['Anfragen', detail.contactCount.toLocaleString('de-AT')],
    ['Aufrufe', detail.viewCount.toLocaleString('de-AT')],
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/dienstleistungen/projekte" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alle Projektaufträge
      </Link>
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusBadge status={project.status} expired={projectExpired(project)} />
          {openReports.length ? <Badge tone="danger">{openReports.length} offene Meldung(en)</Badge> : null}
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal break-words text-ink-950">{project.title}</h2>
        <p className="text-sm text-ink-500">
          <Link href={`/dienstleistungen/projekte/${project.id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            Ansicht mit Team-Rechten <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section title="Angaben">
            <dl className="grid gap-2 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-canvas px-3 py-2">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="text-sm font-semibold break-words text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            <h4 className="mt-5 text-sm font-semibold text-ink-900">Beschreibung</h4>
            <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line text-ink-800">{project.description}</p>
            <p className="mt-4 text-xs text-ink-500">
              Prüfhinweis: Fixe Arbeitszeiten, Weisungsgebundenheit oder Eingliederung in einen Betrieb sprechen für ein Arbeitsverhältnis – das gehört unter Jobs, nicht hierher.
            </p>
          </Section>

          <Section title={`Meldungen (${reports.length})`}>
            {reports.length ? (
              <ul className="divide-y divide-line text-sm">
                {reports.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/meldungen/${r.id}`} className="font-semibold text-brand-700 hover:underline">{REPORT_REASON_LABELS[r.reason]}</Link>
                      <ReportStatusBadge status={r.status} />
                      <span className="text-ink-500">{formatDateTime(r.createdAt)}</span>
                    </div>
                    {r.details ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-ink-700">{r.details}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Meldungen.</p>
            )}
          </Section>

          <Section title="Entscheidungen">
            <DecisionList decisions={decisions} />
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="Auftraggeber:in">
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <PersonLink person={client} />
                <UserStatusBadge status={client.status} />
              </p>
              <p className="text-ink-600">{client.business ? 'Gewerbliches Konto' : 'Privates Konto'} · seit {formatDate(client.createdAt)}</p>
              {client.email ? <p className="break-all text-ink-600">{client.email}</p> : null}
            </div>
          </Section>
          <Section title="Entscheiden">
            {own ? (
              <Alert tone="warning">Über eigene Aufträge entscheidet jemand anderer aus dem Team.</Alert>
            ) : (
              <DecisionForm target="project" id={project.id} version={detail.version} options={decisionOptions(project.status)} defaultReason={openReports[0]?.reason} />
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
