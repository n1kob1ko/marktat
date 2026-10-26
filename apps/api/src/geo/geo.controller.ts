import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { GeoService } from './geo.service.js';

@ApiTags('Geografie')
@Public()
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('states')
  @ApiOperation({ summary: 'Bundesländer mit Bezirken' })
  states() {
    return this.geo.states();
  }

  @Get('locations')
  @ApiOperation({ summary: 'Orte nach PLZ oder Ortsname suchen' })
  @ApiQuery({ name: 'q', example: '1010' })
  locations(@Query('q') q = '') {
    return this.geo.searchLocations(String(q).slice(0, 60));
  }
}
