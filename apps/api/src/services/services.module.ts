import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module.js';
import { ImagesModule } from '../images/images.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminServicesService } from './admin-services.service.js';
import { ServiceProfilesService } from './service-profiles.service.js';
import { ServiceSearchService } from './service-search.service.js';
import { AdminServicesController, MyServiceProfileController, ServicesController } from './services.controller.js';

/** Dienstleistungen und Freelancer (Phase 10): Anbieterprofile, Portfolio, Qualifikationen, Suche */
@Module({
  imports: [GeoModule, ImagesModule, MessagesModule, ModerationModule],
  controllers: [ServicesController, MyServiceProfileController, AdminServicesController],
  providers: [ServiceProfilesService, ServiceSearchService, AdminServicesService],
  exports: [ServiceProfilesService],
})
export class ServicesModule {}
