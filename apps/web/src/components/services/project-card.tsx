import Link from 'next/link';
import { CalendarClock, ClipboardList, MapPin } from 'lucide-react';
import { cn } from '@marktat/ui';
import { formatDate, type ServiceProjectSummary } from '@marktat/shared';
import { projectBudgetLabel, projectPlaceLabel } from '@/lib/projects';

/**
 * Karte eines Projektauftrags: ein konkretes Vorhaben, für das jemand eine selbstständige Dienstleistung sucht.
 * Bewusst anders als Anbieterkarten (kein Bild, Kennzeichnung „Projektauftrag“) und ohne Gebote oder Angebotszahlen.
 */
export function ProjectCard({ project, className }: { project: ServiceProjectSummary; className?: string }) {
  const place = projectPlaceLabel(project);
  return (
    <article
      className={cn(
        'group relative flex w-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] sm:p-5',
        className,
      )}
      data-testid="project-card"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-700">
        <ClipboardList className="size-3.5" aria-hidden="true" /> Projektauftrag · {project.category.name}
      </p>
      <h3 className="line-clamp-2 font-sans text-base leading-snug font-semibold tracking-normal text-ink-900">
        <Link href={`/dienstleistungen/projekte/${project.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
          {project.title}
        </Link>
      </h3>
      <p className="line-clamp-3 text-sm text-ink-700">{project.excerpt}</p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
        <div className="min-w-0 space-y-1 text-xs text-ink-600">
          {place ? (
            <p className="flex items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {place}
                {project.distanceKm !== null ? ` · ${project.distanceKm < 1 ? '< 1' : Math.round(project.distanceKm)} km entfernt` : ''}
              </span>
            </p>
          ) : null}
          <p className="flex items-center gap-1">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            {project.timeframe ? <span className="truncate">{project.timeframe}</span> : project.publishedAt ? `seit ${formatDate(project.publishedAt)}` : null}
          </p>
          {!project.acceptsContacts ? <p className="font-medium text-warning-700">Keine neuen Anfragen mehr</p> : null}
        </div>
        <p className="font-semibold text-ink-900">{projectBudgetLabel(project)}</p>
      </div>
    </article>
  );
}
