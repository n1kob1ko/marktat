import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountThrottlerGuard } from './common/throttler.guard.js';
import { loadEnv } from './config/env.js';
import { RATE_LIMIT_STORAGE, type RedisThrottlerStorage } from './common/redis-throttler.storage.js';
import { RateLimitModule } from './common/rate-limit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { MfaGuard } from './auth/mfa.guard.js';
import { UsersModule } from './users/users.module.js';
import { GeoModule } from './geo/geo.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ListingsModule } from './listings/listings.module.js';
import { ImagesModule } from './images/images.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SearchModule } from './search/search.module.js';
import { MailModule } from './mail/mail.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { FavoritesModule } from './favorites/favorites.module.js';
import { SavedSearchesModule } from './saved-searches/saved-searches.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { BillingModule } from './billing/billing.module.js';
import { StatsModule } from './stats/stats.module.js';
import { DealersModule } from './dealers/dealers.module.js';
import { SecurityModule } from './security/security.module.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';

@Module({
  imports: [
    // Rate-Limit pro IP – mit REDIS_URL gemeinsam für alle API-Instanzen, sonst im Prozessspeicher (und immer in Tests)
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage: RedisThrottlerStorage | null) => ({
        throttlers: [{ ttl: 60_000, limit: loadEnv().RATE_LIMIT_PER_MINUTE }],
        storage: storage ?? undefined,
      }),
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    GeoModule,
    CategoriesModule,
    StorageModule.forRoot(),
    SearchModule,
    ListingsModule,
    ImagesModule,
    MailModule,
    JobsModule,
    RealtimeModule,
    FavoritesModule,
    SavedSearchesModule,
    MessagesModule,
    ModerationModule,
    PrivacyModule,
    BillingModule,
    StatsModule,
    DealersModule,
    SecurityModule,
    MonitoringModule,
  ],
  providers: [
    // Reihenfolge: zuerst Anmeldung (Token prüfen), dann Rate-Limit je Konto bzw. IP, dann Rollen, dann 2FA
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AccountThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: MfaGuard },
  ],
})
export class AppModule {}
