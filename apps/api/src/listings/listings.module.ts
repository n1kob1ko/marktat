import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { ImagesModule } from '../images/images.module.js';
import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';

@Module({
  imports: [CategoriesModule, ImagesModule],
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
