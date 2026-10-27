import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Alert, Badge, Select, Skeleton } from '@marktat/ui';
import { formatDate, formatDateTime, REPORT_REASON_LABELS, type AdminUserDetail, type MeResponse, type MfaFactorSummary } from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireStaff } from '@/lib/auth';
import { ENTITY_ID, param, UUID } from '@/lib/admin';
import { FlashMessage } from '@/components/flash-message';
import { SubmitButton } from '@/components/submit-button';
import { ListingStatusBadge } from '@/components/listing-status-badge';
import { DecisionList, ReportStatusBadge, RoleBadge, Section, UserStatusBadge } from '@/components/admin/admin-ui';
import { ActionForm, DecisionForm, type DecisionOption } from '@/components/admin/forms';
import { StepUpField } from '@/components/security/step-up-field';
import { changeRoleAction, resetMfaAction, restrictReportingAction, retryDeletionAction } from '../../actions';

export const metadata: Metadata = { title: 'Konto' };

const DELETION_LABELS = { PENDING: 'Löschung läuft', COMPLETED: 'Gelöscht', FAILED: 'Löschung fehlgeschlagen' } as const;

function accountOptions(viewer: MeResponse, target: AdminUserDetail): DecisionOption[] {
  if (target.status === 'ACTIVE' && (viewer.role === 'ADMIN' || target.role === 'USER')) {
    return [{ value: 'SUSPEND', label: 'Konto sperren', description: 'Anmeldung bleibt möglich, aber nur für Begründung, Einspruch, Datenexport und Löschung. Inserate sind nicht mehr öffentlich.', restrictive: true }];
  }
  if (target.status === 'SUSPENDED' && viewer.role === 'ADMIN') {
    return [{ value: 'RESTORE', label: 'Sperre aufheben', description: 'Das Konto ist wieder voll nutzbar, die Inserate werden wieder sichtbar.', restrictive: false }];
  }
  return [];
}

export default function AdminUserPage({ params, searchParams }: PageProps<'/admin/nutzer/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <AdminUser params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminUser({ params, searchParams }: Pick<PageProps<'/admin/nutzer/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const { user: viewer, token } = await requireStaff(`/admin/nutzer/${id}`);
  let account: AdminUserDetail;
  try {
    account = await api<AdminUserDetail>(`/admin/users/${id}`, { token, cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const isAdmin = viewer.role === 'ADMIN';
  const self = account.id === viewer.id;
  const reportId = param(query, 'meldung');
  const options = accountOptions(viewer, account);
  const stepUp = { enabled: viewer.security?.level === 'aal2', maxAgeMinutes: viewer.security?.stepUpMaxAgeMinutes ?? 10 };
  // 2FA-Stand nur für Teamkonten (nur sie können 2FA einrichten); Fehler der Anmeldeverwaltung blenden den Abschnitt aus
  const mfa =
    isAdmin && !self && account.role !== 'USER' && account.status !== 'DELETED'
      ? await api<{ factors: MfaFactorSummary[] }>(`/admin/users/${id}/mfa`, { token, cache: 'no-store' }).catch(() => null)
      : null;

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Link href="/admin/nutzer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" /> Alle Konten
        </Link>
      ) : null}
      <FlashMessage hinweis={param(query, 'hinweis')} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <UserStatusBadge status={account.status} />
          <RoleBadge role={account.role} />
          <Badge tone={account.accountType === 'BUSINESS' ? 'brand' : 'neutral'}>{account.accountType === 'BUSINESS' ? 'Gewerblich' : 'Privat'}</Badge>
          {account.deletion ? <Badge tone={account.deletion.status === 'FAILED' ? 'danger' : 'neutral'}>{DELETION_LABELS[account.deletion.status]}</Badge> : null}
        </div>
        <h2 className="font-sans text-2xl font-bold tracking-normal break-words text-ink-950">{account.displayName}</h2>
        <p className="text-sm text-ink-500">
          {account.companyName ? `${account.companyName} · ` : ''}Registriert {formatDate(account.createdAt)}
          {account.lastSeenAt ? ` · zuletzt aktiv ${formatDateTime(account.lastSeenAt)}` : ''}
        </p>
        {account.email ? <p className="text-sm break-all text-ink-700">{account.email}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Section title={`Inserate (${account.listings.length})`}>
            {account.listings.length ? (
              <ul className="divide-y divide-line text-sm">
                {account.listings.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Link href={`/admin/inserate/${l.id}`} className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline">{l.title}</Link>
                    <ListingStatusBadge status={l.status} />
                    {l.openReports ? <Badge tone="danger">{l.openReports} Meldung(en)</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Inserate.</p>
            )}
          </Section>

          <Section title={`Meldungen gegen dieses Konto (${account.reportsReceived.length})`}>
            {account.reportsReceived.length ? (
              <ul className="divide-y divide-line text-sm">
                {account.reportsReceived.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Link href={`/admin/meldungen/${r.id}`} className="font-medium text-brand-700 hover:underline">{REPORT_REASON_LABELS[r.reason]}</Link>
                    <ReportStatusBadge status={r.status} />
                    <span className="text-ink-500">{formatDateTime(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Keine Meldungen.</p>
            )}
            <p className="mt-3 text-sm text-ink-500">
              Selbst gemeldet: {account.reportsMade.total}, davon {account.reportsMade.abusive} offensichtlich unbegründet
              {account.reportingBlockedUntil ? ` · Meldefunktion eingeschränkt bis ${formatDate(account.reportingBlockedUntil)}` : ''}
            </p>
          </Section>

          <Section title="Entscheidungen">
            <DecisionList decisions={account.decisions} />
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="Konto sperren oder entsperren">
            {self ? (
              <Alert tone="warning">Das eigene Konto kannst du nicht sperren.</Alert>
            ) : options.length ? (
              <DecisionForm target="user" id={account.id} options={options} reportId={reportId && ENTITY_ID.test(reportId) ? reportId : undefined} stepUp={stepUp} />
            ) : (
              <p className="text-sm text-ink-500">
                {account.status === 'SUSPENDED'
                  ? 'Sperren heben nur Administratoren auf – oder das Team über einen Einspruch.'
                  : account.status === 'DELETED'
                    ? 'Das Konto ist gelöscht.'
                    : 'Konten aus dem Team sperren nur Administratoren.'}
              </p>
            )}
          </Section>

          {isAdmin && !self && account.status !== 'DELETED' ? (
            <>
              <Section title="Rolle">
                {account.role === 'ADMIN' ? (
                  <p className="text-sm text-ink-600">Administrationsrechte werden nur über die Kommandozeile vergeben und entzogen (siehe Betriebsdoku).</p>
                ) : (
                  <ActionForm action={changeRoleAction}>
                    <input type="hidden" name="id" value={account.id} />
                    <input type="hidden" name="role" value={account.role === 'MODERATOR' ? 'USER' : 'MODERATOR'} />
                    <p className="text-sm text-ink-600">
                      {account.role === 'MODERATOR' ? 'Das Konto kann Meldungen bearbeiten und Inserate moderieren.' : 'Moderation: Meldungen bearbeiten, Inserate prüfen, normale Konten sperren.'}
                    </p>
                    <StepUpField {...stepUp} />
                    <SubmitButton variant="outline" size="sm" disabled={account.status !== 'ACTIVE' && account.role === 'USER'}>
                      {account.role === 'MODERATOR' ? 'Moderationsrechte entziehen' : 'Moderationsrechte geben'}
                    </SubmitButton>
                  </ActionForm>
                )}
              </Section>
              <Section title="Meldefunktion (Art. 23 DSA)">
                <ActionForm action={restrictReportingAction}>
                  <input type="hidden" name="id" value={account.id} />
                  <p className="text-sm text-ink-600">Bei häufig offensichtlich unbegründeten Meldungen – nach vorheriger Warnung und nur befristet.</p>
                  <label htmlFor="days" className="block text-sm font-semibold text-ink-900">Zeitraum</label>
                  <div className="flex gap-2">
                    <Select id="days" name="days" defaultValue="30" className="h-9 text-sm">
                      <option value="0">Aufheben</option>
                      <option value="7">7 Tage</option>
                      <option value="30">30 Tage</option>
                      <option value="90">90 Tage</option>
                      <option value="365">365 Tage</option>
                    </Select>
                    <SubmitButton variant="outline" size="sm">Speichern</SubmitButton>
                  </div>
                </ActionForm>
              </Section>
            </>
          ) : null}

          {mfa ? (
            <Section title="Zwei-Faktor-Anmeldung">
              {mfa.factors.length ? (
                <ActionForm action={resetMfaAction}>
                  <input type="hidden" name="id" value={account.id} />
                  <ul className="space-y-1 text-sm text-ink-700">
                    {mfa.factors.map((f) => (
                      <li key={f.createdAt}>
                        {f.friendlyName ?? 'Authenticator-App'} · eingerichtet {formatDate(f.createdAt)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-ink-600">
                    Nur zurücksetzen, wenn die Person keinen Zugriff mehr auf ihre Geräte hat und du ihre Identität auf anderem Weg geprüft hast.
                  </p>
                  <label className="flex items-start gap-2 text-sm text-ink-800">
                    <input type="checkbox" name="confirm" className="mt-0.5 size-4 accent-brand-700" />
                    Identität geprüft – Zwei-Faktor-Anmeldung zurücksetzen
                  </label>
                  <StepUpField {...stepUp} />
                  <SubmitButton variant="danger" size="sm">Zurücksetzen</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-600">Nicht eingerichtet.</p>
              )}
            </Section>
          ) : null}

          {isAdmin && account.deletion?.status === 'FAILED' ? (
            <Section title="Kontolöschung">
              <ActionForm action={retryDeletionAction}>
                <input type="hidden" name="id" value={account.id} />
                <p className="text-sm text-ink-600">Beantragt am {formatDateTime(account.deletion.requestedAt)}. Der Fehler steht im Protokoll.</p>
                <SubmitButton size="sm">Löschung erneut starten</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
