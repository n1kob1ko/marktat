import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { CategoriesService } from './categories.service.js';

@ApiTags('Kategorien')
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Kategoriebaum aller aktiven Kategorien' })
  tree() {
    return this.categories.tree();
  }
}
