import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  rateSchema,
  ratingReplySchema,
  reportListingSchema,
  type RateInput,
  type RatingReplyInput,
  type ReportListingInput,
} from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { pageNumber } from '../favorites/favorites.controller.js';
import { ReportsService } from '../moderation/reports.service.js';
import { RatingsService } from './ratings.service.js';

const WRITE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Bewertungen')
@Controller()
export class RatingsController {
  constructor(
    private readonly ratings: RatingsService,
    private readonly reports: ReportsService,
  ) {}

  @Public()
  @Get('users/:id/ratings')
  @ApiOperation({ summary: 'Öffentliche Bewertungen einer Person (neueste zuerst, 20 je Seite)' })
  list(@Param('id', new ParseUUIDPipe()) id: string, @Query('page') page?: string) {
    return this.ratings.publicList(id, pageNumber(page));
  }

  @Public()
  @Get('users/:id/rating-summary')
  @ApiOperation({ summary: 'Durchschnitt und Anzahl der Bewertungen einer Person' })
  summary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ratings.publicSummary(id);
  }

  @Public()
  @Get('ratings/:id')
  @ApiOperation({ summary: 'Einzelne öffentliche Bewertung' })
  one(@Param('id') id: string) {
    return this.ratings.publicOne(id);
  }

  @Get('me/ratings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Erhaltene und abgegebene Bewertungen' })
  mine(@CurrentUser() user: AuthUser) {
    return this.ratings.mine(user);
  }

  @Get('conversations/:id/rating')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Bewertungen in einer Unterhaltung: ob ich bewerten kann, meine und die der anderen Person',
  })
  forConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ratings.forConversation(user, id);
  }

  @Put('conversations/:id/rating')
  @ApiBearerAuth()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Die andere Person bewerten bzw. die eigene Bewertung ändern' })
  @ApiBody({ schema: openApiSchema(rateSchema) })
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rateSchema)) body: RateInput,
    @Req() req: Request,
  ) {
    return this.ratings.rate(user, id, body, req.ip);
  }

  @Delete('conversations/:id/rating')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Eigene Bewertung löschen' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.ratings.remove(user, id, req.ip);
  }

  @Put('ratings/:id/reply')
  @ApiBearerAuth()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Öffentlich auf eine Bewertung über mich antworten' })
  @ApiBody({ schema: openApiSchema(ratingReplySchema) })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ratingReplySchema)) body: RatingReplyInput,
    @Req() req: Request,
  ) {
    return this.ratings.reply(user, id, body, req.ip);
  }

  @Delete('ratings/:id/reply')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigene Antwort auf eine Bewertung entfernen' })
  removeReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.ratings.removeReply(user, id, req.ip);
  }

  @Post('ratings/:id/report')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Bewertung melden (Art. 16 DSA)' })
  @ApiBody({ schema: openApiSchema(reportListingSchema) })
  report(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reportListingSchema)) body: ReportListingInput,
    @Req() req: Request,
  ) {
    return this.reports.reportRating(user, id, body, req.ip);
  }
}
