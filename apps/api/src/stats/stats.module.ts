import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { ListingStatsService } from './listing-stats.service.js';
import { StatsController } from './stats.controller.js';

@Module({
  imports: [BillingModule],
  controllers: [StatsController],
  providers: [ListingStatsService],
})
export class StatsModule {}
