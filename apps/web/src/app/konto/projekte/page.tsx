import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { buttonClasses, Card, Skeleton } from '@marktat/ui';
import { formatDate, type MyServiceProjects } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { projectBudgetLabel } from '@/lib/projects';
import { FlashMessage } from '@/components/flash-message';
import { ProjectStatusBadge } from '@/components/services/project-status-badge';

export const metadata: Metadata = { title: 'Meine Projektaufträge', robots: { index: false } };

export default function MyProjectsPage({ searchParams }: PageProps<'/konto/projekte'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MyProjectsView searchParams={searchParams} />
    </Suspense>
  );
}

async function MyProjectsView({ searchParams }: Pick<PageProps<'/konto/projekte'>, 'searchParams'>) {
  const [{ token }, params] = await Promise.all([requireUser('/konto/projekte'), searchParams]);
  const hinweis = typeof params.hinweis === 'string' ? params.hinweis : undefined;
  const { projects, openCount, maxOpen } = await api<MyServiceProjects>('/me/projects', { token, cache: 'no-store' });

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="font-sans text-xl font-semibold tracking-normal">Projektaufträge</h2>
          <p className="mt-1 text-sm text-ink-600">
            Beschreibe ein konkretes Vorhaben, und Anbieter:innen mit Anbieterprofil schreiben dir über die Nachrichten. Kein Stellenangebot, keine Ausschreibung, keine Gebühren.
            Offen sind {openCount} von höchstens {maxOpen} Aufträgen.
          </p>
        </div>
        <Link href="/konto/projekte/neu" className={buttonClasses({ size: 'sm' })}>
          <Plus className="size-4" aria-hidden="true" /> Neuer Auftrag
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <ClipboardList className="mx-auto size-8 text-ink-300" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink-900">Noch keine Aufträge</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">Du suchst jemanden für ein Vorhaben, etwa eine Website, Malerarbeiten oder Nachhilfe? Beschreibe es kurz.</p>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Meine Projektaufträge">
          {projects.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/konto/projekte/${p.id}`} className="font-semibold break-words text-ink-900 hover:text-brand-700 hover:underline">
                    {p.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {p.category.name} · {projectBudgetLabel(p)}
                    {p.expiresAt && (p.status === 'ACTIVE' || p.status === 'PAUSED') ? ` · bis ${formatDate(p.expiresAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-ink-600">
                  <span>{p.contactCount === 1 ? '1 Anfrage' : `${p.contactCount} Anfragen`}</span>
                  <ProjectStatusBadge status={p.status} expired={p.expired} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
