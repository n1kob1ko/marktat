import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module.js';
import { SavedSearchesController } from './saved-searches.controller.js';
import { SavedSearchesService } from './saved-searches.service.js';

@Module({
  imports: [ServicesModule],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
