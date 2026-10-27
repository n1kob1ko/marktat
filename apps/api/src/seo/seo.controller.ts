import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { SeoService } from './seo.service.js';

@ApiTags('Suchmaschinen')
@Controller()
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Public()
  @Get('seo/sitemap')
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'Öffentliche Inserate, Händlerprofile und Kategorien für die Sitemap' })
  sitemap() {
    return this.seo.sitemap();
  }
}
