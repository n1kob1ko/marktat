import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { RateLimitModule } from '../common/rate-limit.module.js';
import { AutofillController } from './autofill.controller.js';
import { AutofillService } from './autofill.service.js';

/** Foto-Assistent beim Inserieren (optional, siehe docs/foto-assistent.md) */
@Module({
  imports: [CategoriesModule, RateLimitModule],
  controllers: [AutofillController],
  providers: [AutofillService],
})
export class AutofillModule {}
