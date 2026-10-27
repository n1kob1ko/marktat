import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, Skeleton } from '@marktat/ui';
import { formatDateTime, type AdminDashboard } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { EmptyState, PageTitle, PersonLink, Section, StatCard, table } from '@/components/admin/admin-ui';
import { RegistrationChart } from '@/components/admin/registration-chart';

export const metadata: Metadata = { title: 'Übersicht' };

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const { token } = await requireStaff('/admin');
  const { moderation, system } = await api<AdminDashboard>('/admin/dashboard', { token, cache: 'no-store' });
  const { listings, reports, appeals } = moderation;

  return (
    <div className="space-y-8">
      <section aria-labelledby="queue-heading" className="space-y-4">
        <PageTitle title="Zu bearbeiten" description="Meldungen werden nach Priorität und Alter sortiert. Gesperrt wird nie automatisch – jede Maßnahme entscheidet ein Mensch." />
        <h3 id="queue-heading" className="sr-only">Warteschlangen</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Offene Meldungen" value={reports.open} href="/admin/meldungen?status=OPEN" tone="attention" />
          <StatCard label="Hohe Priorität" value={reports.urgent} hint="hoch oder dringend, stehen oben" href="/admin/meldungen" tone="attention" />
          <StatCard label="In Bearbeitung" value={reports.inReview} href="/admin/meldungen?status=IN_REVIEW" />
          <StatCard label="Offene Einsprüche" value={appeals.open} href="/admin/einsprueche" tone="attention" />
          <StatCard label="Inserate in Prüfung" value={listings.pendingReview} href="/admin/inserate?status=PENDING_REVIEW" tone="attention" />
          <StatCard label="Gemeldete Inserate" value={reports.reportedListings} hint="mit offener Meldung" href="/admin/inserate?status=reported" />
        </div>
      </section>

      <section aria-labelledby="listings-heading" className="space-y-4">
        <h3 id="listings-heading" className="font-sans text-lg font-semibold tracking-normal text-ink-950">Inserate</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Aktiv" value={listings.active} href="/admin/inserate?status=ACTIVE" />
          <StatCard label="Pausiert" value={listings.paused} href="/admin/inserate?status=PAUSED" />
          <StatCard label="Abgelaufen" value={listings.expired} href="/admin/inserate?status=EXPIRED" />
          <StatCard label="Deaktiviert" value={listings.rejected} href="/admin/inserate?status=REJECTED" />
          <StatCard label="Entwürfe" value={listings.draft} />
        </div>
      </section>

      {system ? (
        <>
          <section aria-labelledby="users-heading" className="space-y-4">
            <h3 id="users-heading" className="font-sans text-lg font-semibold tracking-normal text-ink-950">Konten</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Konten gesamt" value={system.users.total} hint="ohne gelöschte" href="/admin/nutzer" />
              <StatCard label="Neu (7 Tage)" value={system.users.new7d} />
              <StatCard label="Neu (30 Tage)" value={system.users.new30d} />
              <StatCard label="Gesperrt" value={system.users.suspended} href="/admin/nutzer?status=SUSPENDED" />
              <StatCard label="Team" value={system.users.staff} hint="Moderation und Administration" href="/admin/nutzer?role=MODERATOR" />
              <StatCard label="Gelöscht" value={system.users.deleted} href="/admin/nutzer?status=DELETED" />
            </div>
            <Section title="Registrierungen der letzten 14 Tage">
              <RegistrationChart data={system.registrations} />
            </Section>
          </section>

          <section aria-labelledby="system-heading" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="system-heading" className="font-sans text-lg font-semibold tracking-normal text-ink-950">System</h3>
              <Link href="/admin/system" className="text-sm font-semibold text-brand-700 hover:underline">Systemzustand und Fehlerübersicht</Link>
            </div>
            {system.deletions.failed > 0 ? (
              <Alert tone="danger" title="Fehlgeschlagene Kontolöschungen">
                {system.deletions.failed} Löschauftrag/-aufträge sind nach mehreren Versuchen gescheitert. Bitte im{' '}
                <Link href="/admin/nutzer?status=DELETED" className="font-semibold underline">Konto</Link> erneut starten.
              </Alert>
            ) : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Aufträge wartend" value={system.jobs.waiting} hint={system.jobs.backend === 'redis' ? 'Redis-Warteschlange' : 'Arbeitsspeicher (ohne Redis)'} />
              <StatCard label="Aufträge geplant" value={system.jobs.delayed} />
              <StatCard label="Aufträge fehlgeschlagen" value={system.jobs.failed} tone="attention" />
              <StatCard label="Löschungen laufend" value={system.deletions.pending} />
              <StatCard label="Löschungen fehlgeschlagen" value={system.deletions.failed} tone="attention" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Letzte Fehler bei Hintergrundaufträgen">
                {system.jobs.recentFailures.length ? (
                  <ul className="divide-y divide-line text-sm">
                    {system.jobs.recentFailures.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="py-2.5">
                        <p className="flex items-center gap-2 font-semibold text-ink-900">
                          <AlertTriangle className="size-4 text-danger-600" aria-hidden="true" /> {f.name}
                          <span className="font-normal text-ink-500">· {f.attempts} Versuch(e){f.failedAt ? ` · ${formatDateTime(f.failedAt)}` : ''}</span>
                        </p>
                        <p className="mt-0.5 break-words text-ink-600">{f.reason}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-500">Keine Fehler.</p>
                )}
              </Section>
              <Section title="Wichtige Ereignisse" actions={<Link href="/admin/protokoll" className="text-sm font-semibold text-brand-700 hover:underline">Ganzes Protokoll</Link>}>
                {system.events.length ? (
                  <div className={table.wrapper}>
                    <table className={table.table}>
                      <thead className={table.head}>
                        <tr>
                          <th className={table.th}>Ereignis</th>
                          <th className={table.th}>Von</th>
                          <th className={table.th}>Zeit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {system.events.map((e) => (
                          <tr key={e.id} className={table.row}>
                            <td className={table.tdMain}><code className="text-xs font-semibold text-ink-900">{e.action}</code></td>
                            <td className={table.td} data-label="Von"><PersonLink person={e.actor} fallback="System" /></td>
                            <td className={table.td} data-label="Zeit">{formatDateTime(e.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState>Noch keine Ereignisse.</EmptyState>
                )}
              </Section>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
