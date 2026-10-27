import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { RATE_LIMIT_STORAGE, RedisThrottlerStorage } from './redis-throttler.storage.js';

/** Stellt den Redis-Speicher für Rate-Limits bereit (null = Prozessspeicher, z. B. ohne Redis und in Tests). */
@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORAGE,
      useFactory: () => {
        const env = loadEnv();
        return env.REDIS_URL && env.NODE_ENV !== 'test' ? new RedisThrottlerStorage(env.REDIS_URL, env.QUEUE_PREFIX) : null;
      },
    },
  ],
  exports: [RATE_LIMIT_STORAGE],
})
export class RateLimitModule {}
