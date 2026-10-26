import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module.js';
import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';

@Module({
  imports: [CategoriesModule],
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
