import Link from 'next/link';
import { BadgeCheck, Briefcase, MapPin, UserRound } from 'lucide-react';
import { cn } from '@marktat/ui';
import { SERVICE_AVAILABILITY_LABELS, type ServiceProfileSummary } from '@marktat/shared';
import { serviceAreaLabel, servicePriceLabel } from '@/lib/services';

const AVAILABILITY_TONE = { AVAILABLE: 'bg-success-700', LIMITED: 'bg-warning-700', UNAVAILABLE: 'bg-ink-300' } as const;

/**
 * Karte eines Anbieterprofils – ein Profil ist eine Person bzw. ein Betrieb, kein Artikel: Bild rund, Name und Art des
 * Anbieters, Kategorien und Fähigkeiten, Einsatzgebiet und Preisangabe. Keine Sterne, keine Bewertungen.
 */
export function ServiceCard({ profile, className }: { profile: ServiceProfileSummary; className?: string }) {
  const area = serviceAreaLabel(profile);
  return (
    <article
      className={cn(
        'group relative flex w-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] sm:p-5',
        className,
      )}
      data-testid="service-card"
    >
      <div className="flex items-start gap-3">
        <span className="size-14 shrink-0 overflow-hidden rounded-full border border-line bg-canvas">
          {profile.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Bild kommt verarbeitet aus der API
            <img src={profile.imageUrl} alt="" width={56} height={56} className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="flex size-full items-center justify-center">
              {profile.provider.business ? <Briefcase className="size-6 text-ink-300" aria-hidden="true" /> : <UserRound className="size-6 text-ink-300" aria-hidden="true" />}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-sans text-base leading-snug font-semibold tracking-normal [overflow-wrap:anywhere] text-ink-900">
            <Link href={`/dienstleistungen/${profile.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {profile.headline}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-ink-600">
            {profile.provider.name}
            <span className="text-ink-500"> · {profile.provider.business ? 'Unternehmen' : 'Privatperson'}</span>
          </p>
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-ink-700">{profile.summary}</p>

      <ul className="flex flex-wrap gap-1.5" aria-label="Kategorien und Fähigkeiten">
        {profile.categories.slice(0, 2).map((c) => (
          <li key={c.slug} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-900">
            {c.name}
          </li>
        ))}
        {profile.skills.slice(0, 3).map((skill) => (
          <li key={skill} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-700">
            {skill}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
        <div className="min-w-0 space-y-1 text-xs text-ink-600">
          {area ? (
            <p className="flex items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {area}
                {profile.distanceKm !== null ? ` · ${profile.distanceKm < 1 ? '< 1' : Math.round(profile.distanceKm)} km entfernt` : ''}
              </span>
            </p>
          ) : null}
          <p className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', AVAILABILITY_TONE[profile.availability])} aria-hidden="true" />
            {SERVICE_AVAILABILITY_LABELS[profile.availability]}
          </p>
          {profile.hasVerifiedQualification ? (
            <p className="flex items-center gap-1 font-medium text-success-700">
              <BadgeCheck className="size-3.5" aria-hidden="true" /> Qualifikation von MarktAT geprüft
            </p>
          ) : null}
        </div>
        <p className="font-semibold text-ink-900">{servicePriceLabel(profile)}</p>
      </div>
    </article>
  );
}
