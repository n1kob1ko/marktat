import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { filter, map, Subject, type Observable } from 'rxjs';
import type { RealtimeEvent } from '@marktat/shared';
import { loadEnv } from '../config/env.js';

interface Envelope {
  userId: string;
  event: RealtimeEvent;
}

/**
 * Verteilt Ereignisse (neue Nachricht, gelesen) an die offenen Verbindungen einer Person.
 * Mit REDIS_URL über Redis Pub/Sub, damit es mit mehreren API-Instanzen funktioniert; sonst im Prozess.
 * Ereignisse sind flüchtig: Wer nicht verbunden ist, lädt beim nächsten Öffnen ohnehin den aktuellen Stand.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly env = loadEnv();
  private readonly channel = `${this.env.QUEUE_PREFIX}:events`;
  private readonly local = new Subject<Envelope>();
  private readonly publisher: Redis | null;
  private readonly subscriber: Redis | null;

  /** Für den Systemzustand: null = ohne Redis betrieben */
  async ping(timeoutMs = 2000): Promise<boolean | null> {
    if (!this.publisher) return null;
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref());
    return Promise.race([this.publisher.ping().then((r) => r === 'PONG').catch(() => false), timeout]);
  }

  constructor() {
    if (!this.env.REDIS_URL) {
      this.publisher = this.subscriber = null;
      return;
    }
    const options = { maxRetriesPerRequest: 2, lazyConnect: false };
    this.publisher = new Redis(this.env.REDIS_URL, options);
    this.subscriber = new Redis(this.env.REDIS_URL, options);
    for (const client of [this.publisher, this.subscriber]) {
      client.on('error', (error: Error) => this.logger.warn(`Redis (Echtzeit): ${error.message}`));
    }
    this.subscriber.subscribe(this.channel).catch((error: Error) => this.logger.warn(`Redis-Abo fehlgeschlagen: ${error.message}`));
    this.subscriber.on('message', (_channel: string, payload: string) => {
      try {
        this.local.next(JSON.parse(payload) as Envelope);
      } catch {
        // fremde oder kaputte Nachricht ignorieren
      }
    });
  }

  publish(userId: string, event: RealtimeEvent) {
    const envelope: Envelope = { userId, event };
    if (!this.publisher) {
      this.local.next(envelope);
      return;
    }
    this.publisher.publish(this.channel, JSON.stringify(envelope)).catch((error: Error) => {
      // Redis gerade weg: wenigstens Verbindungen dieser Instanz erreichen
      this.logger.warn(`Ereignis nicht über Redis verteilt: ${error.message}`);
      this.local.next(envelope);
    });
  }

  /** Ereignisse für genau eine Person */
  eventsFor(userId: string): Observable<RealtimeEvent> {
    return this.local.pipe(
      filter((envelope) => envelope.userId === userId),
      map((envelope) => envelope.event),
    );
  }

  async onModuleDestroy() {
    this.local.complete();
    await Promise.all([this.subscriber?.quit().catch(() => undefined), this.publisher?.quit().catch(() => undefined)]);
  }
}
