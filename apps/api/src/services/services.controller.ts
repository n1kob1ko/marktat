import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  adminServiceQuerySchema,
  listingDecisionSchema,
  portfolioItemDecisionSchema,
  portfolioItemSchema,
  qualificationReviewSchema,
  qualificationSchema,
  reportListingSchema,
  sendMessageSchema,
  serviceProfileSchema,
  servicePublishSchema,
  type AdminServiceQuery,
  type ListingDecisionInput,
  type PortfolioItemDecisionInput,
  type QualificationReviewInput,
  type RawSearchParams,
  type ReportListingInput,
  type SendMessageInput,
  type ServiceProfileFields,
} from '@marktat/shared';
import type { z } from 'zod';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MEDIA_UPLOAD_PREFIX } from '../images/media.js';
import { MessagesService } from '../messages/messages.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { ReportsService } from '../moderation/reports.service.js';
import { AdminServicesService } from './admin-services.service.js';
import { ServiceProfilesService } from './service-profiles.service.js';
import { ServiceSearchService } from './service-search.service.js';

/** Schreibende Aktionen der Anbieter (Spam-Schutz) */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const IMAGE_LIMIT = { default: { limit: 20, ttl: 60_000 } };
const DECIDE_LIMIT = { default: { limit: 30, ttl: 60_000 } };
/** Wie beim Anschreiben zu Inseraten; die Grenzwerte je Konto prüft der MessagesService */
const CONTACT_LIMIT = { default: { limit: 30, ttl: 60_000 } };

type PortfolioFields = z.output<typeof portfolioItemSchema>;
type QualificationFields = z.output<typeof qualificationSchema>;

function redirectImage(res: Response, target: { url: string; isPublic: boolean } | null) {
  if (!target) throw new NotFoundException('Dieses Bild gibt es nicht.');
  res.setHeader('Cache-Control', `${target.isPublic ? 'public' : 'private'}, max-age=1800`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.redirect(302, target.url);
}

@ApiTags('Dienstleistungen')
@Controller('services')
export class ServicesController {
  constructor(
    private readonly profiles: ServiceProfilesService,
    private readonly search: ServiceSearchService,
    private readonly reports: ReportsService,
    private readonly messages: MessagesService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Anbieter von Dienstleistungen suchen',
    description:
      'Parameter wie in der Such-URL der Website (siehe docs/dienstleistungen.md): q, bereich, kategorie, plz, ort, umkreis (km), remote=ja, ' +
      'verfuegbar=ja, preis_bis (Euro), anbieter (privat, gewerblich), sortierung (relevanz, neueste, preis_auf, entfernung), seite, pageSize.',
  })
  list(@Query() query: RawSearchParams) {
    return this.search.searchParams(query);
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Kategorien der Dienstleistungen' })
  categories() {
    return this.profiles.categories();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Anbieterprofil (nicht sichtbare nur für die Inhaberin bzw. den Inhaber und das Team)' })
  findOne(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.profiles.findOne(id, viewer);
  }

  @Public()
  @SkipThrottle()
  @Get(':id/image/:variant')
  @ApiOperation({ summary: 'Profilbild (Varianten: large, thumb) – Weiterleitung auf den Bildspeicher' })
  async image(@Param('id') id: string, @Param('variant') variant: string, @Query('exp') exp: string | undefined, @Query('sig') sig: string | undefined, @Res() res: Response) {
    redirectImage(res, await this.profiles.imageDownload(id, variant, exp, sig));
  }

  @Public()
  @SkipThrottle()
  @Get(':id/portfolio/:itemId/image/:variant')
  @ApiOperation({ summary: 'Bild eines Portfolio-Eintrags – Weiterleitung auf den Bildspeicher' })
  async portfolioImage(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Param('variant') variant: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    redirectImage(res, await this.profiles.portfolioImageDownload(id, itemId, variant, exp, sig));
  }

  @Post(':id/conversations')
  @Throttle(CONTACT_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Anbieter:in anschreiben (setzt eine bestehende Unterhaltung fort; Blockieren und Grenzwerte wie bei Inseraten)' })
  @ApiBody({ schema: openApiSchema(sendMessageSchema) })
  contact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput, @Req() req: Request) {
    return this.messages.startForService(user, id, body.body, req.ip, body.clientId);
  }

  @Post(':id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Anbieterprofil melden (z. B. falsche Qualifikation, fremde Bilder, Betrug)' })
  @ApiBody({ schema: openApiSchema(reportListingSchema) })
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(reportListingSchema)) body: ReportListingInput, @Req() req: Request) {
    return this.reports.reportServiceProfile(user, id, body, req.ip);
  }
}

/** Eigenes Anbieterprofil – Teil des bestehenden Kontos, keine eigene Registrierung */
@ApiTags('Dienstleistungen – Anbieter')
@ApiBearerAuth()
@Controller()
export class MyServiceProfileController {
  constructor(private readonly profiles: ServiceProfilesService) {}

  @Get('me/service-profile')
  @ApiOperation({ summary: 'Eigenes Anbieterprofil (profile=null, wenn noch keines angelegt ist)' })
  me(@CurrentUser() user: AuthUser) {
    return this.profiles.me(user);
  }

  @Put('me/service-profile')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Anbieterprofil anlegen oder ändern (neu angelegte Profile sind Entwürfe)' })
  @ApiBody({ schema: openApiSchema(serviceProfileSchema) })
  save(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(serviceProfileSchema)) body: ServiceProfileFields, @Req() req: Request) {
    return this.profiles.save(user, body, req.ip);
  }

  @Post('me/service-profile/publish')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Entwurf veröffentlichen (Bestätigung der Angaben: confirmed=true)' })
  @ApiBody({ schema: openApiSchema(servicePublishSchema) })
  publish(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(servicePublishSchema)) _body: unknown, @Req() req: Request) {
    return this.profiles.publish(user, req.ip);
  }

  @Post('me/service-profile/pause')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Profil vorübergehend ausblenden' })
  pause(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.profiles.pause(user, req.ip);
  }

  @Post('me/service-profile/resume')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Pausiertes Profil wieder anzeigen' })
  resume(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.profiles.resume(user, req.ip);
  }

  @Post('me/service-profile/resubmit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Überarbeitetes, abgelehntes Profil erneut zur Prüfung einreichen' })
  resubmit(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.profiles.resubmit(user, req.ip);
  }

  @Delete('me/service-profile')
  @HttpCode(204)
  @ApiOperation({ summary: 'Anbieterprofil löschen (Konto bleibt bestehen)' })
  async remove(@CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.profiles.remove(user, req.ip);
  }

  @Put(`${MEDIA_UPLOAD_PREFIX}/service-profile`)
  @Throttle(IMAGE_LIMIT)
  @ApiOperation({
    summary: 'Profilbild hochladen (Rohdaten: JPEG, PNG oder WebP, max. 15 MB)',
    description: 'Pflicht: rechte=OWN|CLIENT_PERMISSION|LICENSED; bei lizenzierten Bildern zusätzlich quelle=… (Urheber bzw. Quelle).',
  })
  uploadImage(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.profiles.uploadImage(user, req.body, query, req.ip);
  }

  @Delete('me/service-profile/image')
  @ApiOperation({ summary: 'Profilbild entfernen' })
  deleteImage(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.profiles.deleteImage(user, req.ip);
  }

  @Post('me/service-profile/portfolio')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Portfolio-Eintrag anlegen (Bild danach separat hochladen)' })
  @ApiBody({ schema: openApiSchema(portfolioItemSchema) })
  addItem(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(portfolioItemSchema)) body: PortfolioFields, @Req() req: Request) {
    return this.profiles.addPortfolioItem(user, normalizePortfolio(body), req.ip);
  }

  @Patch('me/service-profile/portfolio/:id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Portfolio-Eintrag ändern' })
  @ApiBody({ schema: openApiSchema(portfolioItemSchema) })
  updateItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(portfolioItemSchema)) body: PortfolioFields, @Req() req: Request) {
    return this.profiles.updatePortfolioItem(user, id, normalizePortfolio(body), req.ip);
  }

  @Delete('me/service-profile/portfolio/:id')
  @ApiOperation({ summary: 'Portfolio-Eintrag löschen' })
  removeItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.profiles.removePortfolioItem(user, id, req.ip);
  }

  @Put(`${MEDIA_UPLOAD_PREFIX}/service-portfolio/:id`)
  @Throttle(IMAGE_LIMIT)
  @ApiOperation({
    summary: 'Bild eines Portfolio-Eintrags hochladen (Rohdaten: JPEG, PNG oder WebP, max. 15 MB)',
    description: 'Pflicht: rechte=OWN|CLIENT_PERMISSION|LICENSED; bei lizenzierten Bildern zusätzlich quelle=….',
  })
  uploadItemImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.profiles.uploadPortfolioImage(user, id, req.body, query, req.ip);
  }

  @Delete('me/service-profile/portfolio/:id/image')
  @ApiOperation({ summary: 'Bild eines Portfolio-Eintrags entfernen' })
  deleteItemImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.profiles.deletePortfolioImage(user, id, req.ip);
  }

  @Post('me/service-profile/qualifications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Qualifikation angeben (erscheint als „nicht geprüft“, bis das Team sie geprüft hat)' })
  @ApiBody({ schema: openApiSchema(qualificationSchema) })
  addQualification(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(qualificationSchema)) body: QualificationFields, @Req() req: Request) {
    return this.profiles.addQualification(user, { title: body.title, issuer: body.issuer ?? null, reference: body.reference ?? null }, req.ip);
  }

  @Delete('me/service-profile/qualifications/:id')
  @ApiOperation({ summary: 'Qualifikation entfernen' })
  removeQualification(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.profiles.removeQualification(user, id, req.ip);
  }
}

function normalizePortfolio(body: PortfolioFields) {
  return { title: body.title, description: body.description ?? null, url: body.url ?? null, categorySlug: body.categorySlug ?? null };
}

/** Moderation der Anbieterprofile (mindestens MODERATOR) */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin')
export class AdminServicesController {
  constructor(
    private readonly admin: AdminServicesService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('services')
  @ApiOperation({ summary: 'Anbieterprofile zur Prüfung (Standard: in Prüfung, gemeldet oder Qualifikation offen)' })
  list(@Query(new ZodValidationPipe(adminServiceQuerySchema)) query: AdminServiceQuery) {
    return this.admin.list(query);
  }

  @Get('services/:id')
  @ApiOperation({ summary: 'Anbieterprofil mit Qualifikationen, Meldungen und Entscheidungen' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.detail(user, id);
  }

  @Post('services/:id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Profil deaktivieren, bis zur Prüfung ausblenden oder freigeben (mit Begründung)' })
  @ApiBody({ schema: openApiSchema(listingDecisionSchema) })
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(listingDecisionSchema)) body: ListingDecisionInput, @Req() req: Request) {
    return this.moderation.decideServiceProfile(user, id, body, req.ip);
  }

  @Post('service-portfolio/:id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Portfolio-Eintrag ausblenden oder wieder zeigen (mit Begründung)' })
  @ApiBody({ schema: openApiSchema(portfolioItemDecisionSchema) })
  decidePortfolio(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(portfolioItemDecisionSchema)) body: PortfolioItemDecisionInput,
    @Req() req: Request,
  ) {
    return this.moderation.decidePortfolioItem(user, id, body, req.ip);
  }

  @Post('service-qualifications/:id/review')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Qualifikation als geprüft bestätigen oder ablehnen' })
  @ApiBody({ schema: openApiSchema(qualificationReviewSchema) })
  review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(qualificationReviewSchema)) body: QualificationReviewInput, @Req() req: Request) {
    return this.admin.reviewQualification(user, id, body, req.ip);
  }
}
