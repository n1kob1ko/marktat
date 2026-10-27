import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { appealSchema, reportListingSchema, type AppealInput, type ReportListingInput } from '@marktat/shared';
import { AllowSuspended, CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ModerationService } from './moderation.service.js';
import { NotificationsService } from './notifications.service.js';
import { ReportsService } from './reports.service.js';

const markReadSchema = z.object({ ids: z.array(z.string().regex(/^[a-z0-9]{20,40}$/)).max(100).optional() }).strict();

/** Meldungen, Entscheidungen, Einsprüche und Mitteilungen aus Sicht der Nutzerinnen und Nutzer */
@ApiTags('Meldungen und Entscheidungen')
@ApiBearerAuth()
@Controller()
export class ModerationController {
  constructor(
    private readonly reports: ReportsService,
    private readonly moderation: ModerationService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('listings/:id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inserat melden (Art. 16 DSA)' })
  @ApiBody({ schema: openApiSchema(reportListingSchema) })
  reportListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reportListingSchema)) body: ReportListingInput,
    @Req() req: Request,
  ) {
    return this.reports.reportListing(user, id, body, req.ip);
  }

  @Post('listings/:id/resubmit')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abgelehntes, überarbeitetes Inserat erneut zur Prüfung einreichen' })
  resubmit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.moderation.resubmit(user, id, req.ip);
  }

  @Get('me/decisions')
  @AllowSuspended()
  @ApiOperation({ summary: 'Eigene Moderationsentscheidungen mit Begründung' })
  decisions(@CurrentUser() user: AuthUser) {
    return this.moderation.myDecisions(user);
  }

  @Get('me/decisions/:id')
  @AllowSuspended()
  @ApiOperation({ summary: 'Eine eigene Moderationsentscheidung' })
  decision(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.moderation.myDecision(user, id);
  }

  @Post('me/decisions/:id/appeal')
  @AllowSuspended()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Einspruch gegen eine Entscheidung (Art. 20 DSA)' })
  @ApiBody({ schema: openApiSchema(appealSchema) })
  appeal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(appealSchema)) body: AppealInput,
    @Req() req: Request,
  ) {
    return this.moderation.appeal(user, id, body, req.ip);
  }

  @Get('me/notifications')
  @AllowSuspended()
  @ApiOperation({ summary: 'Mitteilungen im Konto (neueste 30)' })
  notificationList(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Post('me/notifications/read')
  @AllowSuspended()
  @HttpCode(200)
  @ApiOperation({ summary: 'Mitteilungen als gelesen markieren (ohne ids: alle)' })
  @ApiBody({ schema: openApiSchema(markReadSchema) })
  markRead(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(markReadSchema)) body: z.infer<typeof markReadSchema>) {
    return this.notifications.markRead(user.id, body.ids);
  }
}
