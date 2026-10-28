import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  adminDealQuerySchema,
  assignDealMerchantSchema,
  dealsBlockSchema,
  listingDecisionSchema,
  type AdminDealQuery,
  type AssignDealMerchantInput,
  type DealsBlockInput,
  type ListingDecisionInput,
} from '@marktat/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { StepUp } from '../auth/mfa.guard.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { AdminDealsService } from './admin-deals.service.js';

const DECIDE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** Deal-Moderation. Mindestens MODERATOR; Zuordnung zu einem anderen Konto nur ADMIN. */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin')
export class AdminDealsController {
  constructor(
    private readonly admin: AdminDealsService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('deals')
  @ApiOperation({ summary: 'Deals zur Prüfung (Standard: in Prüfung oder gemeldet)' })
  list(@Query(new ZodValidationPipe(adminDealQuerySchema)) query: AdminDealQuery) {
    return this.admin.list(query);
  }

  @Get('deals/:id')
  @ApiOperation({ summary: 'Deal mit Händler, Meldungen, Entscheidungen und möglichen Doppelten' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.detail(user, id);
  }

  @Post('deals/:id/decisions')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Deal deaktivieren, bis zur Prüfung ausblenden oder freigeben (mit Begründung)' })
  @ApiBody({ schema: openApiSchema(listingDecisionSchema) })
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(listingDecisionSchema)) body: ListingDecisionInput, @Req() req: Request) {
    return this.moderation.decideDeal(user, id, body, req.ip);
  }

  @Put('deals/:id/merchant')
  @StepUp()
  @Roles('ADMIN')
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Deal einem anderen gewerblichen Konto zuordnen (nur Administratoren)' })
  @ApiBody({ schema: openApiSchema(assignDealMerchantSchema) })
  assignMerchant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(assignDealMerchantSchema)) body: AssignDealMerchantInput, @Req() req: Request) {
    return this.admin.assignMerchant(user, id, body, req.ip);
  }

  @Post('users/:id/deals-block')
  @StepUp()
  @Throttle(DECIDE_LIMIT)
  @ApiOperation({ summary: 'Konto für Deals sperren (Moderation) oder Sperre aufheben (nur Administratoren)' })
  @ApiBody({ schema: openApiSchema(dealsBlockSchema) })
  dealsBlock(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(dealsBlockSchema)) body: DealsBlockInput, @Req() req: Request) {
    return this.moderation.decideDealsBlock(user, id, body, req.ip);
  }
}
