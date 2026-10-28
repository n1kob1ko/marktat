import { Module } from '@nestjs/common';
import { loadEnv, signingSecret } from '../config/env.js';
import { ImageUrls } from './image-urls.js';
import { MediaUrls } from './media.js';
import { ImagesController } from './images.controller.js';
import { ListingImagesController } from './listing-images.controller.js';
import { ListingImagesService } from './listing-images.service.js';

@Module({
  controllers: [ListingImagesController, ImagesController],
  providers: [
    ListingImagesService,
    {
      provide: ImageUrls,
      useFactory: () => new ImageUrls(loadEnv().API_URL, signingSecret(loadEnv())),
    },
    {
      provide: MediaUrls,
      useFactory: () => new MediaUrls(loadEnv().API_URL, signingSecret(loadEnv())),
    },
  ],
  exports: [ImageUrls, MediaUrls],
})
export class ImagesModule {}
