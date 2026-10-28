import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Eye, MessageCircle } from 'lucide-react';
import { Alert, buttonClasses, Card, Skeleton } from '@marktat/ui';
import { MODERATION_ACTION_LABELS, formatDate, type MyServiceProject } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { FlashMessage } from '@/components/flash-message';
import { ProjectStatusBadge } from '@/components/services/project-status-badge';
import { DeleteProjectForm, ProjectForm, ProjectStatusActions } from '../forms';

export const metadata: Metadata = { title: 'Projektauftrag verwalten', robots: { index: false } };

export default function ManageProjectPage({ params, searchParams }: PageProps<'/konto/projekte/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <ManageProject params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ManageProject({ params, searchParams }: Pick<PageProps<'/konto/projekte/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { token } = await requireUser(`/konto/projekte/${id}`);
  let project: MyServiceProject;
  try {
    project = await api<MyServiceProject>(`/me/projects/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const editable = project.status !== 'CLOSED';

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/konto/projekte" className="hover:text-brand-700 hover:underline">Projektaufträge</Link>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-xl font-semibold tracking-normal break-words">{project.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <ProjectStatusBadge status={project.status} expired={project.expired} />
            {project.expiresAt && (project.status === 'ACTIVE' || project.status === 'PAUSED') ? (
              <span>{project.expired ? `abgelaufen am ${formatDate(project.expiresAt)}` : `sichtbar bis ${formatDate(project.expiresAt)}`}</span>
            ) : null}
            <span>
              · {project.contactCount === 1 ? '1 Anfrage' : `${project.contactCount} Anfragen`} · {project.viewCount === 1 ? '1 Aufruf' : `${project.viewCount} Aufrufe`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.contactCount ? (
            <Link href="/nachrichten" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              <MessageCircle className="size-4" aria-hidden="true" /> Anfragen lesen
            </Link>
          ) : null}
          <Link href={`/dienstleistungen/projekte/${project.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <Eye className="size-4" aria-hidden="true" /> Ansehen
          </Link>
        </div>
      </div>

      {project.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[project.moderation.action]}>
          {project.moderation.statement}{' '}
          <Link href={`/konto/entscheidungen/${project.moderation.decisionId}`} className="font-semibold underline">
            Begründung und Einspruch
          </Link>
        </Alert>
      ) : project.reviewReason && project.status === 'PENDING_REVIEW' ? (
        <Alert tone="info" title="In Prüfung">{project.reviewReason}</Alert>
      ) : null}

      <Card className="space-y-3 p-5 sm:p-7">
        <h3 className="font-sans text-lg font-semibold tracking-normal">Status</h3>
        {project.status === 'CLOSED' ? (
          <p className="text-sm text-ink-600">Beendet{project.closedAt ? ` am ${formatDate(project.closedAt)}` : ''}. Neue Anfragen sind nicht mehr möglich; bestehende Unterhaltungen bleiben.</p>
        ) : null}
        {project.expired ? <p className="text-sm text-ink-600">Die Laufzeit ist vorbei – der Auftrag ist nicht mehr öffentlich. Verlängere ihn, wenn du noch suchst.</p> : null}
        <ProjectStatusActions project={project} />
      </Card>

      {editable ? (
        <Card className="p-5 sm:p-7">
          <h3 className="mb-4 font-sans text-lg font-semibold tracking-normal">Angaben</h3>
          <ProjectForm project={project} />
        </Card>
      ) : null}

      <Card className="p-5 sm:p-7">
        <h3 className="mb-3 font-sans text-lg font-semibold tracking-normal">Auftrag löschen</h3>
        <DeleteProjectForm id={project.id} />
      </Card>
    </div>
  );
}
