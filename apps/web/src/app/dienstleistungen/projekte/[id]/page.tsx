import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BadgeInfo, CalendarClock, ClipboardList, Flag, Globe, MapPin, MessageCircle, Pencil, ShieldCheck, Wallet } from 'lucide-react';
import { Alert, Badge, buttonClasses, Card, Container, Skeleton } from '@marktat/ui';
import { MODERATION_ACTION_LABELS, PROJECT_MAX_CONTACTS, formatDate, type ServiceProjectDetail } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, getCurrentUser, isStaff } from '@/lib/auth';
import { metaDescription } from '@/lib/seo';
import { projectBudgetLabel, projectExpired, projectPlaceLabel } from '@/lib/projects';
import { FlashMessage } from '@/components/flash-message';
import { ContactForm } from '@/components/messages/contact-form';
import { ProjectStatusBadge } from '@/components/services/project-status-badge';

async function loadProject(id: string, token: string | null) {
  try {
    return await api<ServiceProjectDetail>(`/projects/${id}`, { token: token ?? undefined, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<'/dienstleistungen/projekte/[id]'>): Promise<Metadata> {
  const [{ id }, token] = await Promise.all([params, getAccessToken()]);
  const project = await loadProject(id, token).catch(() => null);
  if (!project) return { title: 'Projektauftrag nicht gefunden', robots: { index: false } };
  const description = metaDescription(project.description, `Projektauftrag: ${project.title}`);
  return {
    title: `${project.title} – Projektauftrag`,
    description,
    alternates: { canonical: `/dienstleistungen/projekte/${project.id}` },
    ...(project.isPublic ? {} : { robots: { index: false, follow: false } }),
    openGraph: { type: 'article', title: project.title, description, url: `/dienstleistungen/projekte/${project.id}` },
  };
}

export default function ProjectPage({ params, searchParams }: PageProps<'/dienstleistungen/projekte/[id]'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-[30rem]" />}>
        <ProjectContent params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function ProjectContent({ params, searchParams }: Pick<PageProps<'/dienstleistungen/projekte/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, token] = await Promise.all([params, searchParams, getAccessToken()]);
  const project = await loadProject(id, token);
  if (!project) notFound();
  const staff = token ? isStaff(await getCurrentUser()) : false;
  const hinweis = typeof query.hinweis === 'string' ? query.hinweis : undefined;
  const place = projectPlaceLabel(project);

  return (
    <div className="space-y-6">
      <FlashMessage hinweis={hinweis} />
      {project.isOwner || staff ? <OwnerBar project={project} staff={staff} /> : null}

      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/dienstleistungen" className="hover:text-brand-700 hover:underline">Dienstleistungen</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/dienstleistungen/projekte" className="hover:text-brand-700 hover:underline">Projektaufträge</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/dienstleistungen/projekte?kategorie=${project.category.slug}`} className="hover:text-brand-700 hover:underline">{project.category.name}</Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">
              <ClipboardList className="size-3.5" aria-hidden="true" /> Projektauftrag
            </Badge>
            <Badge tone="neutral">{project.client.business ? 'Unternehmen' : 'Privatperson'}</Badge>
            {!project.isPublic ? <ProjectStatusBadge status={project.status} expired={projectExpired(project)} /> : null}
          </div>
          <h1 className="mt-3 text-2xl leading-tight font-bold text-ink-950 sm:text-3xl">{project.title}</h1>
          <p className="mt-1 text-ink-600">
            {project.client.name}
            {project.publishedAt ? <span className="text-ink-400"> · veröffentlicht am {formatDate(project.publishedAt)}</span> : null}
          </p>

          <dl className="mt-5 grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <Wallet className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
              <dt className="sr-only">Budget</dt>
              <dd className="font-semibold text-ink-900" data-testid="project-budget">{projectBudgetLabel(project)}</dd>
            </div>
            {place ? (
              <div className="flex items-center gap-1.5">
                {project.location ? <MapPin className="size-4 shrink-0 text-ink-500" aria-hidden="true" /> : <Globe className="size-4 shrink-0 text-ink-500" aria-hidden="true" />}
                <dt className="sr-only">Ort</dt>
                <dd>{place}</dd>
              </div>
            ) : null}
            {project.timeframe ? (
              <div className="flex items-center gap-1.5">
                <CalendarClock className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                <dt className="sr-only">Zeitraum</dt>
                <dd>{project.timeframe}</dd>
              </div>
            ) : null}
            {project.expiresAt && project.isPublic ? (
              <div className="flex items-center gap-1.5 text-ink-500">
                <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                <dt className="sr-only">Sichtbar bis</dt>
                <dd>sichtbar bis {formatDate(project.expiresAt)}</dd>
              </div>
            ) : null}
          </dl>

          <h2 className="mt-8 font-sans text-lg font-semibold tracking-normal">Beschreibung</h2>
          <div className="mt-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink-800">{project.description}</div>
        </Card>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-sans text-base font-semibold tracking-normal">Auf den Auftrag antworten</h2>
            {project.isOwner ? (
              <p className="mt-2 text-sm text-ink-600">Antworten von Anbieter:innen findest du unter „Nachrichten“.</p>
            ) : project.conversationId ? (
              <Link href={`/nachrichten/${project.conversationId}`} className={buttonClasses({ size: 'lg', className: 'mt-4 w-full' })}>
                <MessageCircle className="size-5" aria-hidden="true" /> Zur Unterhaltung
              </Link>
            ) : !token ? (
              <>
                <p className="mt-2 text-sm text-ink-600">Antworten können Anbieter:innen mit sichtbarem Anbieterprofil.</p>
                <Link href={`/anmelden?weiter=${encodeURIComponent(`/dienstleistungen/projekte/${project.id}`)}`} className={buttonClasses({ className: 'mt-4 w-full' })}>
                  Anmelden und antworten
                </Link>
              </>
            ) : project.contact?.allowed ? (
              <ContactForm projectId={project.id} sellerName={project.client.name} />
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-600" data-testid="contact-reason">{project.contact?.reason ?? 'Dieser Auftrag nimmt keine Anfragen an.'}</p>
                {project.contact?.reason?.includes('Anbieterprofil') ? (
                  <Link href="/konto/dienstleistungen" className={buttonClasses({ variant: 'outline', className: 'mt-4 w-full' })}>
                    Anbieterprofil anlegen
                  </Link>
                ) : null}
              </>
            )}
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              Höchstens {PROJECT_MAX_CONTACTS} Anbieter:innen können antworten. MarktAT vermittelt nicht und nimmt keine Provision; Angebot, Vertrag und Bezahlung vereinbart ihr
              direkt. Verlange nie Vorauszahlungen für „Vermittlung“ und gib keine Bankdaten weiter, bevor ihr euch einig seid.
            </p>
          </Card>

          <p className="flex gap-2 px-1 text-xs text-ink-500">
            <BadgeInfo className="size-4 shrink-0" aria-hidden="true" />
            Ein Projektauftrag ist kein Stellenangebot und keine Ausschreibung. Mitglied seit {formatDate(project.client.memberSince)}. MarktAT zeigt keine Bewertungen.
          </p>
          {project.isOwner ? null : (
            <Link href={`/melden?projekt=${project.id}`} className="flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-danger-600 hover:underline">
              <Flag className="size-4" aria-hidden="true" /> Auftrag melden
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function OwnerBar({ project, staff }: { project: ServiceProjectDetail; staff: boolean }) {
  return (
    <div className="space-y-3">
      {project.moderation ? (
        <Alert tone="warning" title={MODERATION_ACTION_LABELS[project.moderation.action]}>
          {project.moderation.statement}{' '}
          {project.isOwner ? (
            <Link href={`/konto/entscheidungen/${project.moderation.decisionId}`} className="font-semibold underline">
              Begründung und Einspruch
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
        <span className="flex items-center gap-2 text-sm text-ink-700">
          Status: <ProjectStatusBadge status={project.status} expired={projectExpired(project)} />
        </span>
        <span className="flex-1" />
        {project.isOwner ? (
          <Link href={`/konto/projekte/${project.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <Pencil className="size-4" aria-hidden="true" /> Verwalten
          </Link>
        ) : null}
        {staff ? (
          <Link href={`/admin/dienstleistungen/projekte/${project.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Moderieren
          </Link>
        ) : null}
      </div>
    </div>
  );
}
