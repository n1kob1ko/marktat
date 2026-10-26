import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { UsersModule } from './users/users.module.js';
import { GeoModule } from './geo/geo.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ListingsModule } from './listings/listings.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    // Rate-Limit pro IP (In-Memory; bei mehreren API-Instanzen auf Redis-Storage umstellen)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: loadEnv().RATE_LIMIT_PER_MINUTE }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    GeoModule,
    CategoriesModule,
    ListingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Reihenfolge: zuerst Rate-Limit, dann Anmeldung, dann Rollen
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
