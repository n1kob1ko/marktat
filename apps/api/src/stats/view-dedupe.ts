import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Merkt sich kurzzeitig, wer ein Inserat schon aufgerufen hat (wiederholtes Neuladen zählt nicht).
 * Schlüssel sind HMAC-Werte ohne IP; mit Redis gemeinsam für alle API-Instanzen, sonst im Prozess.
 */
export interface ViewDedupe {
  /** true = erster Aufruf im Zeitfenster (zählen) */
  firstSeen(key: string, ttlSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}

const MAX_MEMORY_KEYS = 100_000;

export class MemoryViewDedupe implements ViewDedupe {
  private readonly seen = new Map<string, number>();

  async firstSeen(key: string, ttlSeconds: number) {
    const now = Date.now();
    const until = this.seen.get(key);
    if (until && until > now) return false;
    if (this.seen.size >= MAX_MEMORY_KEYS) {
      for (const [k, v] of this.seen) if (v <= now) this.seen.delete(k);
      // Immer noch voll: lieber nicht zählen als Speicher sprengen
      if (this.seen.size >= MAX_MEMORY_KEYS) return false;
    }
    this.seen.set(key, now + ttlSeconds * 1000);
    return true;
  }

  async close() {
    this.seen.clear();
  }
}

export class RedisViewDedupe implements ViewDedupe {
  private readonly logger = new Logger(RedisViewDedupe.name);
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly prefix: string,
  ) {
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: true });
    this.redis.on('error', (error: Error) => this.logger.warn(`Redis (Aufrufe): ${error.message}`));
  }

  async firstSeen(key: string, ttlSeconds: number) {
    try {
      const result = await this.redis.set(`${this.prefix}:views:${key}`, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      // Ohne Redis lieber nicht zählen (keine verfälschten Zahlen)
      return false;
    }
  }

  async close() {
    this.redis.disconnect();
  }
}
