import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminDealsController } from './admin-deals.controller.js';
import { AdminDealsService } from './admin-deals.service.js';
import { DealMaintenanceService } from './deal-maintenance.service.js';
import { DealsController, MerchantDealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';

/** Deals & Angebote (Phase 10). Die Suche (DealSearchService) liegt im globalen SearchModule. */
@Module({
  imports: [ImagesModule, ModerationModule],
  controllers: [DealsController, MerchantDealsController, AdminDealsController],
  providers: [DealsService, AdminDealsService, DealMaintenanceService],
  exports: [DealsService],
})
export class DealsModule {}
