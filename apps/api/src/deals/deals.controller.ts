import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  createDealSchema,
  dealerCertificationSchema,
  dealerStoreSchema,
  extendDealSchema,
  reportListingSchema,
  updateDealSchema,
  type CreateDealInput,
  type DealerStoreInput,
  type ExtendDealInput,
  type RawSearchParams,
  type ReportListingInput,
  type UpdateDealInput,
} from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MEDIA_UPLOAD_PREFIX } from '../images/media.js';
import { ReportsService } from '../moderation/reports.service.js';
import { DealSearchService } from './deal-search.service.js';
import { DealsService } from './deals.service.js';

/** Schreibende Aktionen der Händler (Spam-Schutz) */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Deals')
@Controller('deals')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly search: DealSearchService,
    private readonly reports: ReportsService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Aktuelle Deals suchen',
    description:
      'Parameter wie in der Such-URL der Website (siehe docs/deals.md): q, kategorie, haendler, kanal (online/lokal), bundesland, plz, ort, ' +
      'umkreis (km), preis_ab, preis_bis (Euro), rabatt_ab (%), sortierung (relevanz, neueste, endet_bald, rabatt, preis_auf, preis_ab, entfernung), seite, pageSize.',
  })
  list(@Query() query: RawSearchParams) {
    return this.search.searchParams(query);
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Deal-Kategorien' })
  categories() {
    return this.deals.categories();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Deal-Details (nicht sichtbare nur für den Händler und das Team)' })
  findOne(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.deals.findOne(id, viewer);
  }

  @Public()
  @SkipThrottle()
  @Get(':id/image/:variant')
  @ApiOperation({ summary: 'Deal-Bild (Varianten: large, thumb) – Weiterleitung auf den Bildspeicher' })
  async image(
    @Param('id') id: string,
    @Param('variant') variant: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const target = await this.deals.imageDownload(id, variant, exp, sig);
    if (!target) throw new NotFoundException('Dieses Bild gibt es nicht.');
    res.setHeader('Cache-Control', `${target.isPublic ? 'public' : 'private'}, max-age=1800`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(302, target.url);
  }

  @Public()
  @Post(':id/click')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: '„Zum Angebot“: zählt den Klick und liefert die Händler-URL (nur sichtbare Deals)' })
  click(@Param('id') id: string) {
    return this.deals.click(id);
  }

  @Post(':id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deal melden (z. B. irreführender Rabatt, falsche Angaben)' })
  @ApiBody({ schema: openApiSchema(reportListingSchema) })
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(reportListingSchema)) body: ReportListingInput, @Req() req: Request) {
    return this.reports.reportDeal(user, id, body, req.ip);
  }
}

/** Händlerbereich: eigene Deals, Filialen und Bestätigung als gewerbliche:r Anbieter:in */
@ApiTags('Deals – Händler')
@ApiBearerAuth()
@Controller()
export class MerchantDealsController {
  constructor(private readonly deals: DealsService) {}

  @Get('me/deals')
  @ApiOperation({ summary: 'Eigene Deals mit Status, Berechtigung und Zählern' })
  overview(@CurrentUser() user: AuthUser) {
    return this.deals.overview(user);
  }

  @Post('me/deals')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Deal anlegen (publish=false speichert einen Entwurf)' })
  @ApiBody({ schema: openApiSchema(createDealSchema) })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createDealSchema)) body: CreateDealInput, @Req() req: Request) {
    return this.deals.create(user, body, req.ip);
  }

  @Patch('me/deals/:id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Deal bearbeiten (gilt als Bestätigung)' })
  @ApiBody({ schema: openApiSchema(updateDealSchema) })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(updateDealSchema)) body: UpdateDealInput, @Req() req: Request) {
    return this.deals.update(user, id, body, req.ip);
  }

  @Post('me/deals/:id/publish')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Entwurf veröffentlichen' })
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.publish(user, id, req.ip);
  }

  @Post('me/deals/:id/pause')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Deal pausieren' })
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.pause(user, id, req.ip);
  }

  @Post('me/deals/:id/resume')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Pausierten Deal fortsetzen' })
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.resume(user, id, req.ip);
  }

  @Post('me/deals/:id/verify')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: '„Angebot gilt weiterhin“ – setzt „Zuletzt geprüft“' })
  verify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.verify(user, id, req.ip);
  }

  @Post('me/deals/:id/extend')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Laufzeit verlängern (höchstens 90 Tage)' })
  @ApiBody({ schema: openApiSchema(extendDealSchema) })
  extend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(extendDealSchema)) body: ExtendDealInput, @Req() req: Request) {
    return this.deals.extend(user, id, body, req.ip);
  }

  @Post('me/deals/:id/resubmit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abgelehnten Deal nach Überarbeitung erneut prüfen lassen' })
  resubmit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.resubmit(user, id, req.ip);
  }

  @Delete('me/deals/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Deal löschen' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.deals.remove(user, id, req.ip);
  }

  @Put(`${MEDIA_UPLOAD_PREFIX}/deals/:id`)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Bild hochladen (Rohdaten: JPEG, PNG oder WebP, max. 15 MB)',
    description: 'Pflicht: rechte=OWN|MANUFACTURER|LICENSED; bei Hersteller- und Lizenzbildern zusätzlich quelle=… (Urheber bzw. Quelle).',
  })
  uploadImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.deals.uploadImage(user, id, req.body, query, req.ip);
  }

  @Delete('me/deals/:id/image')
  @ApiOperation({ summary: 'Bild entfernen' })
  deleteImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.deals.deleteImage(user, id, req.ip);
  }

  @Get('me/dealer-eligibility')
  @ApiOperation({ summary: 'Voraussetzungen zum Veröffentlichen von Deals' })
  eligibility(@CurrentUser() user: AuthUser) {
    return this.deals.eligibility(user.id);
  }

  @Post('me/dealer-certification')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Bestätigung als gewerbliche:r Anbieter:in (Art. 30 DSA)' })
  @ApiBody({ schema: openApiSchema(dealerCertificationSchema) })
  certify(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(dealerCertificationSchema)) _body: unknown, @Req() req: Request) {
    return this.deals.certify(user, req.ip);
  }

  @Get('me/stores')
  @ApiOperation({ summary: 'Eigene Filialen' })
  stores(@CurrentUser() user: AuthUser) {
    return this.deals.stores(user);
  }

  @Post('me/stores')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Filiale anlegen' })
  @ApiBody({ schema: openApiSchema(dealerStoreSchema) })
  createStore(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(dealerStoreSchema)) body: DealerStoreInput, @Req() req: Request) {
    return this.deals.createStore(user, body, req.ip);
  }

  @Put('me/stores/:id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Filiale bearbeiten' })
  @ApiBody({ schema: openApiSchema(dealerStoreSchema) })
  updateStore(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(dealerStoreSchema)) body: DealerStoreInput, @Req() req: Request) {
    return this.deals.updateStore(user, id, body, req.ip);
  }

  @Delete('me/stores/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Filiale löschen (lokale Deals nur dieser Filiale werden pausiert)' })
  async deleteStore(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.deals.deleteStore(user, id, req.ip);
  }
}
