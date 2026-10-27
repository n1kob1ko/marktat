import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module.js';
import { DealersController } from './dealers.controller.js';
import { DealersService } from './dealers.service.js';

@Module({
  imports: [ImagesModule],
  controllers: [DealersController],
  providers: [DealersService],
})
export class DealersModule {}
