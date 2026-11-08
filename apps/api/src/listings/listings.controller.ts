import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createListingSchema,
  updateListingSchema,
  type CreateListingInput,
  type RawSearchParams,
  type UpdateListingInput,
} from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { openApiSchema } from '../common/openapi.js';
import { ListingSearchService } from '../search/listing-search.service.js';
import { ListingsService } from './listings.service.js';

/** Strengeres Limit für schreibende Aktionen (Spam-Schutz) */
const WRITE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('Inserate')
@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly search: ListingSearchService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Suche in aktiven Inseraten',
    description:
      'Parameter wie in der Such-URL der Website (siehe docs/suche.md): q, bereich, kategorie (Pfad oder ID), bundesland, plz, ort, ' +
      'umkreis (5/10/25/50/100/200 km), preis_ab, preis_bis (Euro), anbieter (privat/gewerblich), zustand, sortierung, seite, pageSize ' +
      'sowie die Eigenschaftsfilter der Kategorie (z. B. kraftstoff=diesel, kilometer_bis=100000). Ungültige Werte ergeben 400.',
  })
  list(@Query() query: RawSearchParams) {
    return this.search.searchParams(query);
  }

  @Public()
  @Get('category-counts')
  @ApiOperation({ summary: 'Aktive Inserate je Bereich und Kategoriepfad (inklusive Unterkategorien), ohne Filter' })
  categoryCounts() {
    return this.search.categoryCounts();
  }

  @Public()
  @Get('price-hint')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Preisvorschlag: Preisspanne ähnlicher Inserate',
    description:
      'kategorie (ID einer Kategorie), optional ort (Orts-ID). Liefert unteres Viertel, Mitte und oberes Viertel der Festpreise/VB aktiver ' +
      'Inserate derselben Kategorie im Umkreis von 50 km, bei zu wenigen Treffern in ganz Österreich; unter 3 Inseraten keine Spanne.',
  })
  priceHint(@Query('kategorie') categoryId?: string, @Query('ort') locationId?: string) {
    if (!categoryId || !/^[a-z0-9]{1,40}$/.test(categoryId)) throw new BadRequestException('Bitte gib eine Kategorie an.');
    const ort = locationId ? Number(locationId) : undefined;
    if (ort !== undefined && (!Number.isInteger(ort) || ort <= 0)) throw new BadRequestException('Ungültiger Ort.');
    return this.listings.priceHint(categoryId, ort);
  }

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigene Inserate inkl. Entwürfe' })
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.findMine(user);
  }

  @Public()
  @Get(':id/related')
  @ApiOperation({
    summary: 'Ähnliche Inserate in der Nähe und weitere vom selben Anbieter',
    description: 'Nur zu öffentlich sichtbaren Inseraten, sonst leere Listen. Ähnliche: gleiche Kategorie, andere Anbieter, nächstgelegene zuerst.',
  })
  related(@Param('id') id: string) {
    return this.listings.related(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Inserat-Details (Entwürfe nur für Eigentümer)' })
  findOne(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.listings.findOne(id, viewer);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat anlegen (publish=false speichert einen Entwurf)' })
  @ApiBody({ schema: openApiSchema(createListingSchema) })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createListingSchema)) body: CreateListingInput,
    @Req() req: Request,
  ) {
    return this.listings.create(user, body, req.ip);
  }

  @Patch(':id')
  @Throttle(WRITE_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat bearbeiten' })
  @ApiBody({ schema: openApiSchema(updateListingSchema) })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListingInput,
  ) {
    return this.listings.update(user, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Entwurf veröffentlichen bzw. Inserat verlängern' })
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.publish(user, id, req.ip);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat pausieren' })
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.pause(user, id, req.ip);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pausiertes Inserat fortsetzen' })
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.resume(user, id, req.ip);
  }

  @Post(':id/sold')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat als verkauft markieren' })
  markSold(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.markSold(user, id, req.ip);
  }

  @Post(':id/reserve')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat als reserviert markieren' })
  reserve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.setReserved(user, id, true, req.ip);
  }

  @Post(':id/unreserve')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reservierung aufheben' })
  unreserve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.listings.setReserved(user, id, false, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inserat löschen' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.listings.remove(user, id, req.ip);
  }
}
