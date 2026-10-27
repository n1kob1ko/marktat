import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';
import { NotificationsService } from './notifications.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [ImagesModule],
  controllers: [ModerationController, AdminController],
  providers: [NotificationsService, ReportsService, ModerationService, AdminService],
  exports: [NotificationsService, ReportsService, ModerationService],
})
export class ModerationModule {}
