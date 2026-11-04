import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { DealPriceAlertsService } from './deal-price-alerts.service.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

@Module({
  imports: [ImagesModule],
  controllers: [FavoritesController],
  providers: [FavoritesService, DealPriceAlertsService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
