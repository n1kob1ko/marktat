import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  DEAL_FEED_STATUSES,
  dealFeedReviewSchema,
  dealFeedSchema,
  dealImportCommitSchema,
  dealImportMappingSchema,
  type DealFeedInput,
  type DealFeedReviewInput,
  type DealFeedStatus,
  type DealImportCommitInput,
  type DealImportMapping,
} from '@marktat/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DealFeedService } from './deal-feed.service.js';
import { DealImportService } from './deal-import.service.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
/** Hochladen und Probeabrufe sind teurer (Prüfung jeder Zeile bzw. Abruf beim Händler) */
const HEAVY_LIMIT = { default: { limit: 6, ttl: 60_000 } };

/** CSV-Import und Produktfeeds im Händlerbereich (docs/deals.md, Abschnitt „Importe“) */
@ApiTags('Deals – Händler')
@ApiBearerAuth()
@Controller('me')
export class MerchantDealImportsController {
  constructor(
    private readonly imports: DealImportService,
    private readonly feeds: DealFeedService,
  ) {}

  @Get('deal-imports')
  @ApiOperation({ summary: 'Importhistorie (letzte 50)' })
  list(@CurrentUser() user: AuthUser) {
    return this.imports.list(user);
  }

  @Post('deal-imports')
  @Throttle(HEAVY_LIMIT)
  @ApiOperation({
    summary: 'CSV-Datei hochladen → Vorschau (nichts wird übernommen)',
    description: 'Rohdaten mit Content-Type text/csv (max. 2 MB, 1000 Zeilen, UTF-8 oder Windows-1252). Optional ?datei=Dateiname.',
  })
  upload(@CurrentUser() user: AuthUser, @Query('datei') fileName: string | undefined, @Req() req: Request) {
    return this.imports.upload(user, req.body, typeof fileName === 'string' ? fileName : undefined, req.ip);
  }

  @Get('deal-imports/:id')
  @ApiOperation({ summary: 'Vorschau bzw. Ergebnis je Zeile' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.imports.get(user, id);
  }

  @Put('deal-imports/:id/mapping')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Spaltenzuordnung ändern (Vorschau wird neu berechnet)' })
  setMapping(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealImportMappingSchema)) mapping: DealImportMapping) {
    return this.imports.setMapping(user, id, mapping);
  }

  @Post('deal-imports/:id/commit')
  @HttpCode(200)
  @Throttle(HEAVY_LIMIT)
  @ApiOperation({ summary: 'Vorschau übernehmen (fehlerhafte Zeilen werden übersprungen)' })
  @ApiBody({ schema: openApiSchema(dealImportCommitSchema) })
  commit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealImportCommitSchema)) body: DealImportCommitInput, @Req() req: Request) {
    return this.imports.commit(user, id, body, req.ip);
  }

  @Delete('deal-imports/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Vorschau verwerfen (Rohdaten werden gelöscht)' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.imports.cancel(user, id);
  }

  @Get('deal-feeds')
  @ApiOperation({ summary: 'Eigene Produktfeeds' })
  feedList(@CurrentUser() user: AuthUser) {
    return this.feeds.list(user);
  }

  @Post('deal-feeds')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Produktfeed hinterlegen (wird erst nach Freigabe durch das Team abgerufen)' })
  @ApiBody({ schema: openApiSchema(dealFeedSchema) })
  feedCreate(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(dealFeedSchema)) body: DealFeedInput, @Req() req: Request) {
    return this.feeds.create(user, body, req.ip);
  }

  @Put('deal-feeds/:id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Produktfeed bearbeiten (neue Adresse oder neues Format → neue Freigabe)' })
  @ApiBody({ schema: openApiSchema(dealFeedSchema) })
  feedUpdate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealFeedSchema)) body: DealFeedInput, @Req() req: Request) {
    return this.feeds.update(user, id, body, req.ip);
  }

  @Put('deal-feeds/:id/mapping')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Spaltenzuordnung des Feeds' })
  feedMapping(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealImportMappingSchema)) mapping: DealImportMapping) {
    return this.feeds.setMapping(user, id, mapping);
  }

  @Post('deal-feeds/:id/preview')
  @HttpCode(200)
  @Throttle(HEAVY_LIMIT)
  @ApiOperation({ summary: 'Probeabruf mit Vorschau (übernimmt nichts)' })
  feedPreview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.feeds.preview(user, id, req.ip);
  }

  @Post('deal-feeds/:id/pause')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Feed pausieren' })
  feedPause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.feeds.setPaused(user, id, true, req.ip);
  }

  @Post('deal-feeds/:id/resume')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Pausierten oder angehaltenen Feed fortsetzen' })
  feedResume(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.feeds.setPaused(user, id, false, req.ip);
  }

  @Delete('deal-feeds/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Feed entfernen (seine Deals bleiben, werden aber nicht mehr aktualisiert)' })
  async feedRemove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.feeds.remove(user, id, req.ip);
  }
}

/** Freigabe der Produktfeeds und Übersicht der Importfehler (mindestens MODERATOR) */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin')
export class AdminDealImportsController {
  constructor(
    private readonly imports: DealImportService,
    private readonly feeds: DealFeedService,
  ) {}

  @Get('deal-feeds')
  @ApiOperation({ summary: 'Produktfeeds (optional ?status=PENDING|APPROVED|REJECTED|PAUSED|FAILING)' })
  feedList(@Query('status') status?: string) {
    const filter = DEAL_FEED_STATUSES.includes(status as DealFeedStatus) ? (status as DealFeedStatus) : undefined;
    return this.feeds.adminList(filter);
  }

  @Post('deal-feeds/:id/review')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Feed freigeben, ablehnen oder anhalten' })
  @ApiBody({ schema: openApiSchema(dealFeedReviewSchema) })
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealFeedReviewSchema)) body: DealFeedReviewInput, @Req() req: Request) {
    return this.feeds.review(user, id, body, req.ip);
  }

  @Get('deal-imports')
  @ApiOperation({ summary: 'Importfehler der letzten 30 Tage' })
  failures() {
    return this.imports.adminFailures();
  }

  @Get('deal-imports/:id')
  @ApiOperation({ summary: 'Import mit Ergebnis je Zeile' })
  importDetail(@Param('id') id: string) {
    return this.imports.adminGet(id);
  }
}
