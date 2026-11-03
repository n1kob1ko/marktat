import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { RatingsModule } from '../ratings/ratings.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [ImagesModule, ModerationModule, RatingsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
