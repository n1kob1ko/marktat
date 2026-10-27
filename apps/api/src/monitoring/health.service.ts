import { Injectable } from '@nestjs/common';
import type { HealthCheck, HealthStatus, SystemHealth } from '@marktat/shared';
import { loadEnv } from '../config/env.js';
import { JobsService } from '../jobs/jobs.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SearchIndexService } from '../search/search-index.service.js';

const TIMEOUT_MS = 2000;
const startedAt = new Date();

async function timed(fn: () => Promise<boolean | null>): Promise<{ status: HealthStatus; latencyMs: number | null; detail?: string }> {
  const start = performance.now();
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), TIMEOUT_MS).unref());
    const ok = await Promise.race([fn(), timeout]);
    const latencyMs = Math.round(performance.now() - start);
    if (ok === null) return { status: 'disabled', latencyMs: null };
    return ok ? { status: 'ok', latencyMs } : { status: 'down', latencyMs, detail: 'Keine gültige Antwort' };
  } catch (error) {
    return { status: 'down', latencyMs: Math.round(performance.now() - start), detail: (error as Error).message.slice(0, 120) };
  }
}

/**
 * Systemzustand. Kritisch ist nur die Datenbank (ohne sie geht nichts); Suche, Redis und Auth werden als
 * „eingeschränkt“ gemeldet, weil die API dafür Ausweichwege hat (Postgres-Suche, Aufträge im Prozess).
 */
@Injectable()
export class HealthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchIndexService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {}

  async database() {
    return timed(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    });
  }

  async checks(): Promise<Record<string, HealthCheck>> {
    const [database, redis, search, auth] = await Promise.all([
      this.database(),
      timed(() => this.realtime.ping(TIMEOUT_MS)),
      timed(async () => (this.search.client ? this.search.client.isHealthy() : null)),
      timed(async () => {
        const response = await fetch(`${this.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/health`, {
          headers: this.env.SUPABASE_SERVICE_ROLE_KEY ? { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY } : {},
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return response.ok;
      }),
    ]);
    return {
      database: { ...database, critical: true },
      redis: { ...redis, critical: false },
      search: { ...search, critical: false },
      auth: { ...auth, critical: false },
      mail: { status: this.mail.enabled ? 'ok' : 'disabled', latencyMs: null, critical: false, detail: this.mail.enabled ? 'SMTP konfiguriert' : 'SMTP_HOST fehlt – E-Mails werden nur protokolliert' },
    };
  }

  static overall(checks: Record<string, HealthCheck>): HealthStatus {
    const values = Object.values(checks);
    if (values.some((c) => c.critical && c.status === 'down')) return 'down';
    if (values.some((c) => c.status === 'down')) return 'degraded';
    return 'ok';
  }

  async system(): Promise<SystemHealth> {
    const [checks, jobs, errors] = await Promise.all([
      this.checks(),
      this.jobs.stats().catch(() => null),
      this.prisma.errorEvent.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 50 }).catch(() => []),
    ]);
    const memory = process.memoryUsage();
    return {
      status: HealthService.overall(checks),
      checkedAt: new Date().toISOString(),
      checks,
      jobs,
      errors: errors.map((e) => ({
        id: e.id.toString(),
        source: e.source,
        route: e.route,
        errorName: e.errorName,
        message: e.message,
        stack: e.stack,
        count: e.count,
        firstSeenAt: e.firstSeenAt.toISOString(),
        lastSeenAt: e.lastSeenAt.toISOString(),
      })),
      process: {
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        node: process.version,
        version: process.env.APP_VERSION ?? null,
        environment: this.env.NODE_ENV,
      },
    };
  }
}
