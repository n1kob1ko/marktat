import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  adminBookingQuerySchema,
  billingModeSchema,
  updateBillingSettingsSchema,
  updateProductSchema,
  type AdminBookingQuery,
  type BillingModeInput,
  type UpdateBillingSettingsInput,
  type UpdateProductInput,
} from '@marktat/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BillingAdminService } from './billing-admin.service.js';
import { BookingsService } from './bookings.service.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** Monetarisierung im Admin-Bereich – ausschließlich ADMIN (Rolle aus der Datenbank). */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/billing')
export class AdminBillingController {
  constructor(
    private readonly admin: BillingAdminService,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Betriebsmodus, Leistungen, Einführungsaktion, Stripe-Status und Kennzahlen' })
  overview() {
    return this.admin.overview();
  }

  @Get('bookings')
  @ApiOperation({ summary: 'Buchungen filtern' })
  list(@Query(new ZodValidationPipe(adminBookingQuerySchema)) query: AdminBookingQuery) {
    return this.bookings.adminList(query);
  }

  @Put('products/:code')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Leistung bearbeiten (Preis, geplanter Preis, Laufzeit, Verfügbarkeit, Limits)' })
  @ApiBody({ schema: openApiSchema(updateProductSchema) })
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @Req() req: Request,
  ) {
    return this.admin.updateProduct(user, code, body, req.ip);
  }

  @Put('settings')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Einführungsaktion und Schutzgrenzen' })
  @ApiBody({ schema: openApiSchema(updateBillingSettingsSchema) })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateBillingSettingsSchema)) body: UpdateBillingSettingsInput,
    @Req() req: Request,
  ) {
    return this.admin.updateSettings(user, body, req.ip);
  }

  @Put('mode')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Betriebsmodus wechseln (kostenpflichtig nur mit Bestätigung und nutzbarem Stripe)' })
  @ApiBody({ schema: openApiSchema(billingModeSchema) })
  setMode(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(billingModeSchema)) body: BillingModeInput, @Req() req: Request) {
    return this.admin.setMode(user, body, req.ip);
  }
}
