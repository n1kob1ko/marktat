import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Alert, Badge, type BadgeTone, Field, Input, Skeleton } from '@marktat/ui';
import {
  AFFILIATE_FEED_STATUS_LABELS,
  AFFILIATE_MEMBERSHIP_LABELS,
  AFFILIATE_PROGRAM_STATUS_LABELS,
  AFFILIATE_SKIP_REASON_LABELS,
  AFFILIATE_SYNC_KIND_LABELS,
  AFFILIATE_SYNC_STATUS_LABELS,
  formatDateTime,
  type AffiliateFeedStatus,
  type AffiliateFeedView,
  type AffiliateMembership,
  type AffiliateOverview,
  type AffiliateProgramStatus,
  type AffiliateProgramView,
  type AffiliateSkipReason,
  type AffiliateSyncRunView,
  type AffiliateSyncStats,
  type AffiliateSyncStatus,
  type DealCategoryView,
} from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { getDealCategories } from '@/lib/data';
import { SubmitButton } from '@/components/submit-button';
import { EmptyState, PageTitle, Section, StatCard, table } from '@/components/admin/admin-ui';
import { ActionForm } from '@/components/admin/forms';
import { AffiliateProgramForm } from '@/components/admin/affiliate-program-form';
import { affiliateSyncAction, reviewAffiliateFeedAction } from '../actions';

export const metadata: Metadata = { title: 'Partnerprogramme' };

const PROGRAM_TONES: Record<AffiliateProgramStatus, BadgeTone> = { PENDING: 'warning', APPROVED: 'success', PAUSED: 'neutral', REJECTED: 'danger' };
const MEMBERSHIP_TONES: Record<AffiliateMembership, BadgeTone> = { JOINED: 'success', NOT_JOINED: 'neutral', PENDING: 'warning', SUSPENDED: 'danger', UNKNOWN: 'neutral' };
const FEED_TONES: Record<AffiliateFeedStatus, BadgeTone> = { PENDING: 'warning', ACTIVE: 'success', PAUSED: 'neutral', FAILING: 'danger', REMOVED: 'neutral' };
const RUN_TONES: Record<AffiliateSyncStatus, BadgeTone> = { RUNNING: 'brand', SUCCESS: 'success', PARTIAL: 'warning', FAILED: 'danger' };

export default function AdminAffiliatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Affiliate />
    </Suspense>
  );
}

async function Affiliate() {
  const { user, token } = await requireStaff('/admin/affiliate');
  const [overview, categories] = await Promise.all([api<AffiliateOverview>('/admin/affiliate', { token, cache: 'no-store' }), getDealCategories()]);
  const isAdmin = user.role === 'ADMIN';
  const stepUp = { enabled: user.security?.level === 'aal2', maxAgeMinutes: user.security?.stepUpMaxAgeMinutes ?? 10 };
  const { config, counts } = overview;
  const liveReady = config.enabled && config.missing.length === 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Partnerprogramme (Affiliate)"
        description="Zentrale Partnerangebote über Awin – getrennt von Deals, die Händler selbst anlegen oder per eigenem Feed liefern. Veröffentlicht wird nur, was hier freigegeben ist und laut Awin eine aktive Partnerschaft hat."
        actions={
          isAdmin && liveReady ? (
            <ActionForm action={affiliateSyncAction} className="flex items-center gap-2">
              <input type="hidden" name="kind" value="ALL" />
              <SubmitButton size="sm">Jetzt abrufen</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      <Section title="Verbindung">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-500">Liveimport</dt>
          <dd>
            {config.enabled ? <Badge tone="success">eingeschaltet</Badge> : <Badge tone="neutral">aus (AWIN_ENABLED=false)</Badge>}
          </dd>
          <dt className="text-ink-500">Zugangsdaten</dt>
          <dd>{config.missing.length ? `fehlen: ${config.missing.join(', ')}` : 'vollständig (Werte werden nie angezeigt)'}</dd>
          <dt className="text-ink-500">Automatischer Abruf</dt>
          <dd>{config.scheduled ? 'läuft – Feedliste stündlich, Aktionen alle 4 Stunden, Feeds nur bei neuem Stand' : 'nicht geplant'}</dd>
          <dt className="text-ink-500">Letzter erfolgreicher Abruf</dt>
          <dd>{overview.lastSuccessfulSync ? formatDateTime(overview.lastSuccessfulSync) : 'noch keiner'}</dd>
          <dt className="text-ink-500">Letzter Produktfeed</dt>
          <dd>{overview.lastSuccessfulFeedSync ? formatDateTime(overview.lastSuccessfulFeedSync) : 'noch keiner'}</dd>
        </dl>
      </Section>

      {overview.warnings.length ? (
        <div className="space-y-2" aria-label="Warnungen">
          {overview.warnings.map((warning) => (
            <Alert key={warning.message} tone={warning.level === 'error' ? 'danger' : 'warning'}>
              {warning.message}
            </Alert>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aktive Partnerangebote" value={counts.activeDeals} hint="öffentlich sichtbar" />
        <StatCard label="Verbundene Händler" value={counts.connectedPrograms} hint={`${counts.pendingPrograms} warten auf Freigabe`} />
        <StatCard label="Fehlerhafte Feeds" value={counts.failingFeeds} tone="attention" />
        <StatCard label="Abgelaufen oder nicht lieferbar" value={counts.expiredDeals} hint="letzte 30 Tage, ausgeblendet" />
        <StatCard label="Ohne erlaubtes Bild" value={counts.withoutImage} hint="laufende Angebote" />
        <StatCard label="Ungültige Preise" value={counts.invalidPrices} hint="übersprungen, letzte 7 Tage" tone="attention" />
        <StatCard label="In Prüfung" value={counts.inReview} hint="z. B. Rabatt ab 70 %" href="/admin/deals?status=PENDING_REVIEW" tone="attention" />
        <StatCard label="Aktionen & Gutscheine" value={counts.activePromotions} hint="auf /deals sichtbar" />
      </div>

      <Section title="Programme und Feeds">
        {overview.programs.length === 0 ? (
          <EmptyState>
            Noch keine Programme. Sie erscheinen nach dem ersten Abruf der Feedliste – also erst, wenn der Liveimport eingeschaltet und die Zugangsdaten hinterlegt sind.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {overview.programs.map((program) => (
              <ProgramItem key={program.id} program={program} isAdmin={isAdmin} stepUp={stepUp} categories={categories} liveReady={liveReady} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Letzte Abrufe">
        {overview.runs.length === 0 ? (
          <EmptyState>Noch keine Abrufe.</EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Abruf</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Ergebnis</th>
                  <th className={table.th}>Zeit</th>
                </tr>
              </thead>
              <tbody>
                {overview.runs.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function ProgramItem({
  program,
  isAdmin,
  stepUp,
  categories,
  liveReady,
}: {
  program: AffiliateProgramView;
  isAdmin: boolean;
  stepUp: { enabled: boolean; maxAgeMinutes: number };
  categories: DealCategoryView[];
  liveReady: boolean;
}) {
  return (
    <li className="space-y-3 rounded-[var(--radius-card)] border border-line p-4 text-sm" data-testid="affiliate-program">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-950">{program.name}</span>
        <Badge tone={PROGRAM_TONES[program.status]}>{AFFILIATE_PROGRAM_STATUS_LABELS[program.status]}</Badge>
        <Badge tone={MEMBERSHIP_TONES[program.membership]}>Awin: {AFFILIATE_MEMBERSHIP_LABELS[program.membership]}</Badge>
        <span className="text-ink-500">
          Awin-ID {program.externalId}
          {program.region ? ` · ${program.region}` : ''} · {program.activeDeals} sichtbare Angebote
        </span>
      </div>
      {program.status === 'APPROVED' ? (
        <p className="text-ink-600">
          Bilder {program.allowImages ? 'erlaubt' : 'nicht erlaubt'} · Vergleichspreise {program.allowReferencePrices ? 'erlaubt' : 'nicht übernommen'} · Gutscheincodes{' '}
          {program.allowVouchers ? 'erlaubt' : 'nicht angezeigt'}
          {program.defaultCategorySlug ? ` · Standardkategorie ${categories.find((c) => c.slug === program.defaultCategorySlug)?.name ?? program.defaultCategorySlug}` : ''}
        </p>
      ) : null}
      {program.approvalNote ? (
        <p className="text-ink-700">
          <span className="text-ink-500">Dokumentation:</span> {program.approvalNote}
          {program.reviewedBy ? ` (${program.reviewedBy}${program.approvedAt ? `, ${formatDateTime(program.approvedAt)}` : ''})` : ''}
        </p>
      ) : null}
      {program.lastError ? <p className="font-medium text-danger-600">{program.lastError}</p> : null}

      {program.feeds.length ? (
        <ul className="space-y-2">
          {program.feeds.map((feed) => (
            <FeedItem key={feed.id} feed={feed} isAdmin={isAdmin} canActivate={program.status === 'APPROVED'} liveReady={liveReady} />
          ))}
        </ul>
      ) : (
        <p className="text-ink-500">Keine Produktfeeds für dieses Programm.</p>
      )}

      {isAdmin ? (
        <details className="rounded-md border border-line bg-canvas p-3">
          <summary className="cursor-pointer font-semibold text-ink-800">Freigabe bearbeiten</summary>
          <AffiliateProgramForm program={program} categories={categories} stepUp={stepUp} />
        </details>
      ) : null}
    </li>
  );
}

function FeedItem({ feed, isAdmin, canActivate, liveReady }: { feed: AffiliateFeedView; isAdmin: boolean; canActivate: boolean; liveReady: boolean }) {
  return (
    <li className="space-y-2 rounded-md border border-line bg-surface p-3" data-testid="affiliate-feed">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-900">{feed.name}</span>
        <Badge tone={FEED_TONES[feed.status]}>{AFFILIATE_FEED_STATUS_LABELS[feed.status]}</Badge>
        <span className="text-xs text-ink-500">
          Feed {feed.externalId}
          {feed.language ? ` · ${feed.language}` : ''}
          {feed.vertical ? ` · ${feed.vertical}` : ''} · {feed.productCount.toLocaleString('de-AT')} übernommene Produkte
        </span>
      </div>
      <p className="text-xs text-ink-600">
        Stand bei Awin: {feed.networkUpdatedAt ? formatDateTime(feed.networkUpdatedAt) : 'unbekannt'} · übernommen: {feed.processedUpdatedAt ? formatDateTime(feed.processedUpdatedAt) : 'noch nicht'}
        {feed.nextFetchAt && feed.status === 'ACTIVE' ? ` · frühestens wieder ${formatDateTime(feed.nextFetchAt)}` : ''}
      </p>
      {feed.lastError ? (
        <p className="text-xs font-medium text-danger-600">
          {feed.lastError} ({feed.consecutiveFailures}× in Folge)
        </p>
      ) : null}
      {isAdmin ? (
        <div className="flex flex-wrap items-end gap-2">
          {feed.status !== 'REMOVED' ? (
            <ActionForm action={reviewAffiliateFeedAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={feed.id} />
              <Field label="Notiz (optional)" className="min-w-48">
                <Input name="note" maxLength={500} defaultValue={feed.approvalNote ?? ''} />
              </Field>
              {canActivate && feed.status !== 'ACTIVE' ? (
                <SubmitButton size="sm" name="decision" value="ACTIVATE">
                  Aktivieren
                </SubmitButton>
              ) : null}
              {feed.status === 'ACTIVE' || feed.status === 'FAILING' ? (
                <SubmitButton size="sm" variant="outline" name="decision" value="PAUSE">
                  Anhalten
                </SubmitButton>
              ) : null}
            </ActionForm>
          ) : null}
          {liveReady && feed.status === 'ACTIVE' ? (
            <ActionForm action={affiliateSyncAction} className="flex items-end">
              <input type="hidden" name="kind" value="ALL" />
              <input type="hidden" name="feedId" value={feed.id} />
              <SubmitButton size="sm" variant="ghost">
                Feed jetzt abrufen
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function runSummary(stats: AffiliateSyncStats): string {
  if (stats.notModified) return 'unverändert, kein Download';
  const parts: string[] = [];
  if (stats.programs != null) parts.push(`${stats.programs} Programme`);
  if (stats.feeds != null) parts.push(`${stats.feeds} Feeds`);
  if (stats.rows != null) parts.push(`${stats.rows} Zeilen`);
  if (stats.created) parts.push(`${stats.created} neu`);
  if (stats.updated) parts.push(`${stats.updated} aktualisiert`);
  if (stats.unchanged) parts.push(`${stats.unchanged} unverändert`);
  if (stats.ended) parts.push(`${stats.ended} beendet`);
  if (stats.review) parts.push(`${stats.review} in Prüfung`);
  if (stats.withoutImage) parts.push(`${stats.withoutImage} ohne Bild`);
  if (stats.promotions != null) parts.push(`${stats.promotions} Aktionen`);
  if (stats.hidden) parts.push(`${stats.hidden} ausgeblendet`);
  const skipped = Object.entries(stats.skipped ?? {}).filter(([, n]) => n);
  for (const [reason, n] of skipped) parts.push(`${n}× ${AFFILIATE_SKIP_REASON_LABELS[reason as AffiliateSkipReason]}`);
  if (stats.truncated) parts.push('Höchstzahl erreicht, Rest ausgelassen');
  return parts.join(' · ') || '–';
}

function RunRow({ run }: { run: AffiliateSyncRunView }) {
  return (
    <tr className={table.row}>
      <td className={table.tdMain}>
        <span className="font-medium text-ink-900">{AFFILIATE_SYNC_KIND_LABELS[run.kind]}</span>
        {run.feedName ? <span className="block text-xs text-ink-500">{[run.programName, run.feedName].filter(Boolean).join(' · ')}</span> : null}
        {run.manual ? <span className="block text-xs text-ink-500">manuell gestartet</span> : null}
      </td>
      <td className={table.td} data-label="Status">
        <Badge tone={RUN_TONES[run.status]}>{AFFILIATE_SYNC_STATUS_LABELS[run.status]}</Badge>
      </td>
      <td className={table.td} data-label="Ergebnis">
        <span>
          {runSummary(run.stats)}
          {run.error ? <span className="block text-danger-600">{run.error}</span> : null}
        </span>
      </td>
      <td className={table.td} data-label="Zeit">
        {formatDateTime(run.startedAt)}
      </td>
    </tr>
  );
}
