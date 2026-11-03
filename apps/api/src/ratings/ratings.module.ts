import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module.js';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';

@Module({
  imports: [ModerationModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
