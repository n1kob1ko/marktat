import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators.js';
import { SeoService } from './seo.service.js';

@ApiTags('Suchmaschinen')
@Controller()
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Public()
  @Get('seo/sitemap')
  // Große Abfrage: Suchmaschinen holen sie selten, die Antwort ist 15 Minuten cachebar
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'Öffentliche Inserate, Händlerprofile und Kategorien für die Sitemap' })
  sitemap() {
    return this.seo.sitemap();
  }
}
