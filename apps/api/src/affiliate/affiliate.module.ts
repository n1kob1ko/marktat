import { Module } from '@nestjs/common';
import { AdminAffiliateController, AffiliateController } from './affiliate.controller.js';
import { AffiliateAdminService } from './affiliate-admin.service.js';
import { AffiliatePublicService } from './affiliate-public.service.js';
import { AffiliateSyncService } from './affiliate-sync.service.js';
import { AwinClient } from './awin.client.js';

/** Zentrale Affiliate-Deals (Awin-Publisher). Deals selbst und ihre Suche liegen im Deal-Bereich. docs/affiliate.md */
@Module({
  controllers: [AffiliateController, AdminAffiliateController],
  providers: [AwinClient, AffiliateSyncService, AffiliateAdminService, AffiliatePublicService],
  exports: [AffiliateSyncService],
})
export class AffiliateModule {}
