import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  affiliateFeedReviewSchema,
  affiliateManualSyncSchema,
  affiliateProgramReviewSchema,
  type AffiliateFeedReviewInput,
  type AffiliateManualSyncInput,
  type AffiliateProgramReviewInput,
} from '@marktat/shared';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { StepUp } from '../auth/mfa.guard.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AffiliateAdminService } from './affiliate-admin.service.js';
import { AffiliatePublicService } from './affiliate-public.service.js';

const ADMIN_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** Öffentlich: Aktionen und Gutscheine sowie Produktbilder der Partnerprogramme (Kennzeichnung „Werbung“) */
@ApiTags('Deals')
@Controller()
export class AffiliateController {
  constructor(private readonly affiliate: AffiliatePublicService) {}

  @Public()
  @Get('affiliate/promotions')
  @ApiOperation({ summary: 'Aktuelle Aktionen und Gutscheine freigegebener Partnerprogramme (Werbung)' })
  promotions() {
    return this.affiliate.promotions();
  }

  @Public()
  @SkipThrottle()
  @Get('deals/:id/partner-image/:variant')
  @ApiOperation({ summary: 'Produktbild eines Affiliate-Deals – unverändert vom Händler, über MarktAT ausgeliefert' })
  async image(@Param('id') id: string, @Res() res: Response) {
    const image = await this.affiliate.image(id);
    if (!image) throw new NotFoundException('Dieses Bild gibt es nicht.');
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'public, max-age=21600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(image.body);
  }
}

/** Betrieb der Affiliate-Deals: Übersicht für das Team, Freigaben und manueller Abruf nur Administration */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin/affiliate')
export class AdminAffiliateController {
  constructor(private readonly admin: AffiliateAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Affiliate-Übersicht: Programme, Feeds, Abrufe, Datenqualität und Warnungen' })
  overview() {
    return this.admin.overview();
  }

  @Post('programs/:id/review')
  @Roles('ADMIN')
  @StepUp()
  @HttpCode(200)
  @Throttle(ADMIN_LIMIT)
  @ApiOperation({ summary: 'Programm freigeben (mit Dokumentation), anhalten oder ablehnen – nur Administration' })
  @ApiBody({ schema: openApiSchema(affiliateProgramReviewSchema) })
  reviewProgram(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(affiliateProgramReviewSchema)) body: AffiliateProgramReviewInput, @Req() req: Request) {
    return this.admin.reviewProgram(user, id, body, req.ip);
  }

  @Post('feeds/:id/review')
  @Roles('ADMIN')
  @HttpCode(200)
  @Throttle(ADMIN_LIMIT)
  @ApiOperation({ summary: 'Feed aktivieren oder anhalten – nur Administration' })
  @ApiBody({ schema: openApiSchema(affiliateFeedReviewSchema) })
  reviewFeed(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(affiliateFeedReviewSchema)) body: AffiliateFeedReviewInput, @Req() req: Request) {
    return this.admin.reviewFeed(user, id, body, req.ip);
  }

  @Post('sync')
  @Roles('ADMIN')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abruf jetzt starten (Warteschlange) – nur Administration' })
  @ApiBody({ schema: openApiSchema(affiliateManualSyncSchema) })
  manualSync(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(affiliateManualSyncSchema)) body: AffiliateManualSyncInput, @Req() req: Request) {
    return this.admin.manualSync(user, body, req.ip);
  }
}
