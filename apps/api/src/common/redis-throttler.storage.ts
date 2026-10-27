import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// Zähler und Sperre atomar in einem Schritt: gilt für alle API-Instanzen gemeinsam
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}`;

/**
 * Rate-Limit-Speicher in Redis (statt im Prozessspeicher), damit Limits über mehrere API-Instanzen gelten.
 * Ist Redis kurz nicht erreichbar, wird die Anfrage durchgelassen (die Limits je Konto in der Datenbank greifen weiter).
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;

  constructor(url: string, private readonly prefix: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    this.redis.on('error', (error: Error) => this.logger.warn(`Redis (Rate-Limit): ${error.message}`));
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:throttle:${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blockedMs] = (await this.redis.eval(INCREMENT, 2, base, `${base}:blocked`, ttl, limit, blockDuration)) as [number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
        isBlocked: blockedMs > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockedMs / 1000)),
      };
    } catch (error) {
      this.logger.warn(`Rate-Limit nicht geprüft: ${(error as Error).message}`);
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');
