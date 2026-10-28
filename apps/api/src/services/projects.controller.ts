import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  adminProjectQuerySchema,
  listingDecisionSchema,
  projectPublishSchema,
  reportListingSchema,
  sendMessageSchema,
  serviceProjectSchema,
  type AdminProjectQuery,
  type ListingDecisionInput,
  type RawSearchParams,
  type ReportListingInput,
  type SendMessageInput,
  type ServiceProjectFields,
} from '@marktat/shared';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MessagesService } from '../messages/messages.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { ReportsService } from '../moderation/reports.service.js';
import { AdminProjectsService } from './admin-projects.service.js';
import { ProjectsService } from './projects.service.js';

/** Anlegen und Ändern (Spam-Schutz); die Höchstzahl offener Aufträge je Konto prüft der ProjectsService */
const WRITE_LIMIT = { default: { limit: 20, ttl: 60_000 } };
const CREATE_LIMIT = { default: { limit: 10, ttl: 3_600_000 } };
const CONTACT_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const DECIDE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Projektaufträge')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly reports: ReportsService,
    private readonly messages: MessagesService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Projektaufträge suchen',
    description: 'Parameter wie in der Such-URL der Website: q, bereich, kategorie, plz, ort, umkreis (km), remote=ja, sortierung (neueste, entfernung), seite, pageSize.',
  })
  list(@Query() query: RawSearchParams) {
    return this.projects.searchParams(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Projektauftrag (nicht sichtbare nur für die Auftraggeber:in und das Team)' })
  findOne(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.projects.findOne(id, viewer);
  }

  @Post(':id/conversations')
  @Throttle(CONTACT_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Auf einen Auftrag antworten (nur mit sichtbarem Anbieterprofil, höchstens 20 Anbieter:innen je Auftrag)' })
  @ApiBody({ schema: openApiSchema(sendMessageSchema) })
  contact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput, @Req() req: Request) {
    return this.messages.startForProject(user, id, body.body, req.ip, body.clientId);
  }

  @Post(':id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Projektauftrag melden (z. B. verstecktes Jobangebot, Betrug)' })
  @ApiBody({ schema: openApiSchema(reportListingSchema) })
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(reportListingSchema)) body: ReportListingInput, @Req() req: Request) {
    return this.reports.reportProject(user, id, body, req.ip);
  }
}

/** Eigene Projektaufträge */
@ApiTags('Projektaufträge – Auftraggeber')
@ApiBearerAuth()
@Controller('me/projects')
export class MyProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Eigene Projektaufträge mit Zahl der Anfragen' })
  mine(@CurrentUser() user: AuthUser) {
    return this.projects.mine(user);
  }

  @Get(':id')
  mineOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.mineOne(user, id);
  }

  @Post()
  @Throttle(CREATE_LIMIT)
  @ApiOperation({ summary: 'Projektauftrag als Entwurf anlegen' })
  @ApiBody({ schema: openApiSchema(serviceProjectSchema) })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(serviceProjectSchema)) body: ServiceProjectFields, @Req() req: Request) {
    return this.projects.create(user, body, req.ip);
  }

  @Patch(':id')
  @Throttle(WRITE_LIMIT)
  @ApiBody({ schema: openApiSchema(serviceProjectSchema) })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(serviceProjectSchema)) body: ServiceProjectFields, @Req() req: Request) {
    return this.projects.update(user, id, body, req.ip);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Veröffentlichen (Bestätigung: selbstständige Leistung, kein Arbeitsverhältnis)' })
  @ApiBody({ schema: openApiSchema(projectPublishSchema) })
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(projectPublishSchema)) _body: unknown, @Req() req: Request) {
    return this.projects.publish(user, id, req.ip);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.pause(user, id, req.ip);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.resume(user, id, req.ip);
  }

  @Post(':id/close')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Auftrag beenden (z. B. jemand gefunden); keine neuen Anfragen mehr' })
  close(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.close(user, id, req.ip);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Laufzeit um 30 Tage ab heute verlängern (in den letzten 7 Tagen oder danach)' })
  extend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.extend(user, id, req.ip);
  }

  @Post(':id/resubmit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resubmit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.resubmit(user, id, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.projects.remove(user, id, req.ip);
  }
}

/** Moderation der Projektaufträge (mindestens MODERATOR) */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin/projects')
export class AdminProjectsController {
  constructor(
    private readonly admin: AdminProjectsService,
    private readonly moderation: ModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Projektaufträge zur Prüfung (Standard: in Prüfung oder gemeldet)' })
  list(@Query(new ZodValidationPipe(adminProjectQuerySchema)) query: AdminProjectQuery) {
    return this.admin.list(query);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.detail(user, id);
  }

  @Post(':id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Auftrag deaktivieren, bis zur Prüfung ausblenden oder freigeben (mit Begründung)' })
  @ApiBody({ schema: openApiSchema(listingDecisionSchema) })
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(listingDecisionSchema)) body: ListingDecisionInput, @Req() req: Request) {
    return this.moderation.decideProject(user, id, body, req.ip);
  }
}
