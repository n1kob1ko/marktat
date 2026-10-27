import { Module } from '@nestjs/common';
import { SavedSearchesController } from './saved-searches.controller.js';
import { SavedSearchesService } from './saved-searches.service.js';

@Module({
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
