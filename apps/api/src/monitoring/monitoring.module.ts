import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SearchModule } from '../search/search.module.js';
import { ErrorReporter } from './error-reporter.js';
import { HealthAlertService } from './health-alert.service.js';
import { HealthService } from './health.service.js';
import { MonitoringController } from './monitoring.controller.js';

@Global()
@Module({
  imports: [SearchModule, RealtimeModule],
  controllers: [MonitoringController],
  providers: [ErrorReporter, HealthService, HealthAlertService],
  exports: [ErrorReporter],
})
export class MonitoringModule {}
