import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { listingViewSchema, type ListingViewInput } from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ListingStatsService } from './listing-stats.service.js';

const ID = /^[a-z0-9]{20,40}$/;

@ApiTags('Statistiken')
@Controller()
export class StatsController {
  constructor(private readonly stats: ListingStatsService) {}

  @Public()
  @Post('listings/:id/views')
  @HttpCode(202)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Aufruf melden (vom Web-Server, dedupliziert, ohne Eigen- und Team-Aufrufe)' })
  view(@Param('id') id: string, @Body(new ZodValidationPipe(listingViewSchema)) body: ListingViewInput, @CurrentUser() viewer?: AuthUser) {
    if (!ID.test(id)) return { counted: false };
    return this.stats.recordView(id, body.visitor, viewer);
  }

  @Get('listings/:id/stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Statistik eines eigenen Inserats' })
  listing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.stats.listingStats(user, id);
  }

  @Get('me/dealer-dashboard')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Händler-Dashboard (nur gewerbliche Konten)' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.stats.dealerDashboard(user);
  }
}
