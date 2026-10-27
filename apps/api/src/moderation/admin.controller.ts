import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  adminAppealQuerySchema,
  adminAuditQuerySchema,
  adminListingQuerySchema,
  adminReportQuerySchema,
  adminUserQuerySchema,
  appealDecisionSchema,
  changeRoleSchema,
  dismissReportSchema,
  listingDecisionSchema,
  reportingRestrictionSchema,
  updateReportSchema,
  userDecisionSchema,
  type AdminAppealQuery,
  type AdminAuditQuery,
  type AdminListingQuery,
  type AdminReportQuery,
  type AdminUserQuery,
  type AppealDecisionInput,
  type ChangeRoleInput,
  type DismissReportInput,
  type ListingDecisionInput,
  type ReportingRestrictionInput,
  type UpdateReportInput,
  type UserDecisionInput,
} from '@marktat/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';
import { ModerationService } from './moderation.service.js';
import { ReportsService } from './reports.service.js';

/** Schreibende Moderationsaktionen: großzügig für die Arbeit, aber gegen Skripte mit gestohlenen Sitzungen */
const DECIDE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * Admin-Bereich. Die ganze Klasse verlangt mindestens MODERATOR; Verwaltung von Konten, Rollen, Protokoll und
 * Systemstatistiken zusätzlich ADMIN. Rollen kommen ausschließlich aus der Datenbank (siehe AuthGuard).
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Kennzahlen (Systemstatistiken nur für Administratoren)' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.admin.dashboard(user);
  }

  // --- Meldungen ---------------------------------------------------------------

  @Get('reports')
  @ApiOperation({ summary: 'Meldungen filtern (Standard: offen und in Bearbeitung, dringendste zuerst)' })
  reportList(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(adminReportQuerySchema)) query: AdminReportQuery) {
    return this.reports.list(query, user);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Meldung mit Verlauf' })
  report(@Param('id') id: string) {
    return this.reports.detail(id);
  }

  @Get('reports/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Nachrichten einer gemeldeten Unterhaltung (nur während der Bearbeitung, wird protokolliert)' })
  reportMessages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.reports.reportedMessages(user, id, req.ip);
  }

  @Patch('reports/:id')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Priorität, Zuständigkeit oder Notiz' })
  @ApiBody({ schema: openApiSchema(updateReportSchema) })
  updateReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReportSchema)) body: UpdateReportInput,
    @Req() req: Request,
  ) {
    return this.reports.update(user, id, body, req.ip);
  }

  @Post('reports/:id/dismiss')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Meldung ohne Maßnahme abschließen (kein Verstoß)' })
  @ApiBody({ schema: openApiSchema(dismissReportSchema) })
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dismissReportSchema)) body: DismissReportInput,
    @Req() req: Request,
  ) {
    return this.reports.dismiss(user, id, body, req.ip);
  }

  // --- Inserate ----------------------------------------------------------------

  @Get('listings')
  @ApiOperation({ summary: 'Inserate zur Moderation (Standard: in Prüfung oder gemeldet)' })
  listings(@Query(new ZodValidationPipe(adminListingQuerySchema)) query: AdminListingQuery) {
    return this.admin.listings(query);
  }

  @Get('listings/:id')
  @ApiOperation({ summary: 'Inserat mit Bildern, Meldungen und Entscheidungen' })
  listing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.listing(user, id);
  }

  @Post('listings/:id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Inserat deaktivieren, bis zur Prüfung ausblenden oder freigeben (mit Begründung)' })
  @ApiBody({ schema: openApiSchema(listingDecisionSchema) })
  decideListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(listingDecisionSchema)) body: ListingDecisionInput,
    @Req() req: Request,
  ) {
    return this.moderation.decideListing(user, id, body, req.ip);
  }

  // --- Konten ------------------------------------------------------------------

  @Get('users')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Konten suchen (nur Administratoren)' })
  users(@Query(new ZodValidationPipe(adminUserQuerySchema)) query: AdminUserQuery) {
    return this.admin.users(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Konto im Überblick (E-Mail nur für Administratoren)' })
  user(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.user(user, id);
  }

  @Post('users/:id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Konto sperren (Moderation: nur normale Konten) oder Sperre aufheben (nur Administratoren)' })
  @ApiBody({ schema: openApiSchema(userDecisionSchema) })
  decideUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userDecisionSchema)) body: UserDecisionInput,
    @Req() req: Request,
  ) {
    return this.moderation.decideUser(user, id, body, req.ip);
  }

  @Put('users/:id/role')
  @Roles('ADMIN')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Moderationsrechte vergeben oder entziehen (ADMIN nur per Kommandozeile)' })
  @ApiBody({ schema: openApiSchema(changeRoleSchema) })
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleInput,
    @Req() req: Request,
  ) {
    return this.admin.changeRole(user, id, body, req.ip);
  }

  @Put('users/:id/reporting')
  @Roles('ADMIN')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Meldefunktion einschränken (Art. 23 DSA), 0 Tage = aufheben' })
  @ApiBody({ schema: openApiSchema(reportingRestrictionSchema) })
  restrictReporting(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reportingRestrictionSchema)) body: ReportingRestrictionInput,
    @Req() req: Request,
  ) {
    return this.admin.restrictReporting(user, id, body, req.ip);
  }

  // --- Einsprüche --------------------------------------------------------------

  @Get('appeals')
  @ApiOperation({ summary: 'Einsprüche (Standard: offen, älteste zuerst)' })
  appeals(@Query(new ZodValidationPipe(adminAppealQuerySchema)) query: AdminAppealQuery) {
    return this.admin.appeals(query);
  }

  @Get('appeals/:id')
  @ApiOperation({ summary: 'Einspruch mit Entscheidung' })
  appeal(@Param('id') id: string) {
    return this.admin.appeal(id);
  }

  @Post('appeals/:id/decision')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Über einen Einspruch entscheiden' })
  @ApiBody({ schema: openApiSchema(appealDecisionSchema) })
  decideAppeal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(appealDecisionSchema)) body: AppealDecisionInput,
    @Req() req: Request,
  ) {
    return this.moderation.decideAppeal(user, id, body, req.ip);
  }

  // --- Protokoll ---------------------------------------------------------------

  @Get('audit')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Audit-Log (nur Administratoren)' })
  auditLog(@Query(new ZodValidationPipe(adminAuditQuerySchema)) query: AdminAuditQuery) {
    return this.admin.auditLog(query);
  }
}
