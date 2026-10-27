import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import { Alert, Badge, Skeleton } from '@marktat/ui';
import { formatDateTime, type HealthStatus, type SystemHealth } from '@marktat/shared';
import { api } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { EmptyState, PageTitle, Section, StatCard, table } from '@/components/admin/admin-ui';
import { ResolveErrorButton } from './resolve-error-button';

export const metadata: Metadata = { title: 'Systemzustand' };

const COMPONENTS: Record<string, string> = {
  database: 'Datenbank (PostgreSQL)',
  redis: 'Redis (Aufträge, Echtzeit, Rate-Limits)',
  search: 'Suche (Meilisearch)',
  auth: 'Anmeldung (Supabase Auth)',
  mail: 'E-Mail-Versand (SMTP)',
};

const STATUS: Record<HealthStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: typeof CheckCircle2 }> = {
  ok: { label: 'In Ordnung', tone: 'success', icon: CheckCircle2 },
  degraded: { label: 'Eingeschränkt', tone: 'warning', icon: AlertTriangle },
  down: { label: 'Ausgefallen', tone: 'danger', icon: XCircle },
  disabled: { label: 'Nicht eingerichtet', tone: 'neutral', icon: CircleSlash },
};

/** Was bei einem Ausfall passiert – damit die Anzeige ohne Fachwissen einzuordnen ist */
const FALLBACK: Record<string, string> = {
  database: 'Ohne Datenbank ist die Plattform nicht nutzbar.',
  redis: 'Aufträge laufen dann im Prozess, Echtzeit-Nachrichten nur je Instanz.',
  search: 'Die Suche läuft dann langsamer direkt über die Datenbank.',
  auth: 'Anmeldung und Registrierung funktionieren dann nicht; bestehende Sitzungen bis zum Ablauf schon.',
  mail: 'Ohne SMTP werden E-Mails nur protokolliert.',
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className="size-3.5" aria-hidden="true" /> {s.label}
    </Badge>
  );
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} T ${hours} Std.` : hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}

export default function SystemPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <System />
    </Suspense>
  );
}

async function System() {
  const { user, token } = await requireStaff('/admin/system');
  if (user.role !== 'ADMIN') notFound();
  const health = await api<SystemHealth>('/admin/system', { token, cache: 'no-store' });

  return (
    <div className="space-y-8">
      <PageTitle
        title="Systemzustand"
        description={`Stand ${formatDateTime(health.checkedAt)} · Neu laden für eine aktuelle Prüfung. Öffentlich erreichbar ist nur /v1/health/ready ohne Details.`}
        actions={<StatusBadge status={health.status} />}
      />
      {health.status === 'down' ? <Alert tone="danger">Eine kritische Komponente ist ausgefallen. Die Plattform ist derzeit nicht nutzbar.</Alert> : null}
      {health.status === 'degraded' ? <Alert tone="warning">Mindestens eine Komponente ist ausgefallen. Die Plattform läuft eingeschränkt weiter.</Alert> : null}

      <Section title="Komponenten">
        <ul className="divide-y divide-line">
          {Object.entries(health.checks).map(([name, check]) => (
            <li key={name} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-semibold text-ink-900">{COMPONENTS[name] ?? name}</p>
                <p className="text-ink-600">
                  {check.status === 'down' ? FALLBACK[name] : check.detail ?? (check.latencyMs !== null ? `Antwortzeit ${check.latencyMs} ms` : '')}
                </p>
                {check.status === 'down' && check.detail ? <p className="break-words text-ink-500">Fehler: {check.detail}</p> : null}
              </div>
              <StatusBadge status={check.status} />
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Aufträge wartend" value={health.jobs?.waiting ?? '–'} hint={health.jobs?.backend === 'memory' ? 'ohne Redis' : undefined} />
        <StatCard label="Aufträge geplant" value={health.jobs?.delayed ?? '–'} />
        <StatCard label="Aufträge fehlgeschlagen" value={health.jobs?.failed ?? '–'} tone="attention" />
        <StatCard label="Laufzeit" value={duration(health.process.uptimeSeconds)} hint={`${health.process.rssMb} MB Speicher · Node ${health.process.node}`} />
      </div>

      <Section title={`Fehlerübersicht (${health.errors.length})`}>
        <p className="mb-3 text-sm text-ink-600">
          Unerwartete Serverfehler und endgültig gescheiterte Hintergrundaufträge, zusammengefasst je Ursache. Ohne Anfragedaten, Personen oder IDs; Einträge verschwinden 30 Tage
          nach dem letzten Auftreten. Die Anfrage-ID aus einer Fehlermeldung findest du im Server-Log.
        </p>
        {health.errors.length ? (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Fehler</th>
                  <th className={table.th}>Anzahl</th>
                  <th className={table.th}>Zuletzt</th>
                  <th className={table.th}>
                    <span className="sr-only">Aktion</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.errors.map((e) => (
                  <tr key={e.id} className={table.row}>
                    <td className={table.tdMain}>
                      <p className="font-semibold break-words text-ink-900">
                        <Badge tone="neutral">{e.source === 'job' ? 'Auftrag' : e.source === 'web' ? 'Web' : 'API'}</Badge> <code className="text-xs">{e.route}</code>
                      </p>
                      <p className="mt-1 break-words text-ink-700">
                        {e.errorName}: {e.message}
                      </p>
                      {e.stack ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-semibold text-brand-700">Stacktrace</summary>
                          <pre className="mt-1 overflow-x-auto text-xs whitespace-pre text-ink-600">{e.stack}</pre>
                        </details>
                      ) : null}
                    </td>
                    <td className={table.td} data-label="Anzahl">
                      {e.count}
                    </td>
                    <td className={table.td} data-label="Zuletzt">
                      {formatDateTime(e.lastSeenAt)}
                      <span className="block text-xs text-ink-500">seit {formatDateTime(e.firstSeenAt)}</span>
                    </td>
                    <td className={table.td}>
                      <ResolveErrorButton id={e.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Keine Fehler in den letzten 30 Tagen.</EmptyState>
        )}
      </Section>
    </div>
  );
}
