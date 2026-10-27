import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { loadEnv } from '../config/env.js';
import { ErrorReporter } from '../monitoring/error-reporter.js';
import { redact } from '../common/redact.js';

export { redact };

type Handler = (data: Record<string, unknown>) => Promise<void>;

export interface EnqueueOptions {
  delayMs?: number;
  /**
   * Gleiche ID = derselbe Auftrag: Solange er noch wartet, wird kein zweiter angelegt
   * (z. B. eine E-Mail je Unterhaltung, auch wenn mehrere Nachrichten eintreffen).
   */
  jobId?: string;
}

const QUEUE_NAME = 'jobs';
const MAX_REMEMBERED_FAILURES = 50;

export interface JobStats {
  backend: 'redis' | 'memory';
  waiting: number;
  delayed: number;
  failed: number;
  /** Neueste endgültig fehlgeschlagene Aufträge – nur Name, Fehlermeldung und Zeitpunkt, keine Auftragsdaten */
  recentFailures: { name: string; reason: string; attempts: number; failedAt: string | null }[];
}

/**
 * Hintergrundaufgaben (E-Mails, Prüfung gespeicherter Suchen).
 * Mit REDIS_URL über BullMQ: überlebt Neustarts, wiederholt fehlgeschlagene Aufträge, verteilt auf mehrere
 * Instanzen. Ohne Redis (lokal/Tests ohne Infrastruktur) laufen die Aufträge im Prozess mit Timern.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly env = loadEnv();
  private readonly handlers = new Map<string, Handler>();
  private readonly schedules = new Map<string, number>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  // Im-Prozess-Betrieb
  private readonly pending = new Map<string, Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private counter = 0;
  private readonly memoryFailures: JobStats['recentFailures'] = [];

  constructor(@Optional() private readonly reporter?: ErrorReporter) {}

  get usesRedis() {
    return Boolean(this.env.REDIS_URL);
  }

  /** Vor dem Start der Anwendung aufrufen (z. B. in onModuleInit). */
  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  /** Wiederkehrende Aufgabe; wird beim Start eingerichtet (nicht in Tests). */
  every(name: string, intervalMs: number) {
    this.schedules.set(name, intervalMs);
  }

  async onApplicationBootstrap() {
    if (this.env.REDIS_URL) {
      const connection = { url: this.env.REDIS_URL, maxRetriesPerRequest: null };
      this.queue = new Queue(QUEUE_NAME, {
        connection,
        prefix: this.env.QUEUE_PREFIX,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
      this.queue.on('error', (error) => this.logger.warn(`Warteschlange: ${error.message}`));
      if (this.env.JOBS_WORKER) {
        this.worker = new Worker(QUEUE_NAME, (job: Job) => this.run(job.name, job.data as Record<string, unknown>), {
          connection,
          prefix: this.env.QUEUE_PREFIX,
          concurrency: 4,
        });
        this.worker.on('failed', (job, error) => {
          this.logger.warn(`Auftrag ${job?.name} fehlgeschlagen: ${redact(error.message)}`);
          // Erst nach dem letzten Versuch in die Fehlerübersicht (Wiederholungen sind normal)
          if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) this.reporter?.capture(error, { source: 'job', route: job.name });
        });
        this.worker.on('error', (error) => this.logger.warn(`Worker: ${error.message}`));
      }
    }
    if (this.env.NODE_ENV === 'test' || !this.env.JOBS_WORKER) return;
    for (const [name, intervalMs] of this.schedules) {
      if (this.queue) {
        await this.queue.upsertJobScheduler(name, { every: intervalMs }, { name, data: {} }).catch((error: Error) => {
          this.logger.warn(`Zeitplan ${name} konnte nicht angelegt werden: ${error.message}`);
        });
      } else {
        const timer = setInterval(() => void this.add(name, {}, { jobId: name }), intervalMs);
        timer.unref();
        this.timers.add(timer);
      }
    }
  }

  async add(name: string, data: Record<string, unknown>, options: EnqueueOptions = {}): Promise<void> {
    if (!this.handlers.has(name)) throw new Error(`Unbekannter Auftrag ${name}`);
    if (this.queue) {
      await this.queue.add(name, data, { delay: options.delayMs, jobId: options.jobId });
      return;
    }
    const key = options.jobId ?? `${name}:${++this.counter}`;
    if (this.pending.has(key)) return;
    const promise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.run(name, data)
          .catch((error: Error) => {
            this.logger.warn(`Auftrag ${name} fehlgeschlagen: ${redact(error.message)}`);
            this.reporter?.capture(error, { source: 'job', route: name });
            this.memoryFailures.unshift({ name, reason: redact(error.message), attempts: 1, failedAt: new Date().toISOString() });
            this.memoryFailures.length = Math.min(this.memoryFailures.length, MAX_REMEMBERED_FAILURES);
          })
          .finally(() => {
            this.pending.delete(key);
            resolve();
          });
      }, options.delayMs ?? 0);
      this.timers.add(timer);
    });
    this.pending.set(key, promise);
  }

  /** Wartende Aufträge entfernen (z. B. E-Mails an ein Konto, das gerade gelöscht wird). Unbekannte IDs sind kein Fehler. */
  async cancel(jobIds: string[]): Promise<void> {
    for (const jobId of jobIds) {
      if (this.queue) {
        // Laufende oder gesperrte Aufträge lassen sich nicht entfernen; ihre Handler prüfen den Zustand selbst.
        await this.queue.remove(jobId).catch(() => 0);
      }
    }
  }

  /** Zustand der Warteschlange für das Admin-Dashboard */
  async stats(): Promise<JobStats> {
    if (!this.queue) {
      return {
        backend: 'memory',
        waiting: this.pending.size,
        delayed: 0,
        failed: this.memoryFailures.length,
        recentFailures: this.memoryFailures.slice(0, 10),
      };
    }
    const counts = await this.queue.getJobCounts('waiting', 'delayed', 'failed');
    const failed = await this.queue.getJobs(['failed'], 0, 9, false);
    return {
      backend: 'redis',
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      recentFailures: failed.map((job) => ({
        name: job.name,
        reason: redact(job.failedReason ?? 'Unbekannter Fehler'),
        attempts: job.attemptsMade,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      })),
    };
  }

  /** Für Tests: wartet, bis alle anstehenden Aufträge erledigt sind. */
  async drain(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.queue) {
        const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'waiting-children');
        if (Object.values(counts).every((n) => n === 0)) return;
      } else {
        if (!this.pending.size) return;
        await Promise.all(this.pending.values());
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Hintergrundaufträge wurden nicht rechtzeitig fertig.');
  }

  /** Für Tests: entfernt alle wartenden Aufträge. */
  async clear(): Promise<void> {
    await this.queue?.drain(true);
  }

  private async run(name: string, data: Record<string, unknown>) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Unbekannter Auftrag ${name}`);
    await handler(data);
  }

  async onApplicationShutdown() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.worker?.close();
    await this.queue?.close();
  }
}
