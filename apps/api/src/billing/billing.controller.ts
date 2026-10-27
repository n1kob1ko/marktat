import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createBookingSchema, type CreateBookingInput } from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BookingsService } from './bookings.service.js';
import { PricingService } from './pricing.service.js';

const ID = /^[a-z0-9]{20,40}$/;

@ApiTags('Leistungen')
@Controller()
export class BillingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
  ) {}

  @Public()
  @Get('billing')
  @ApiOperation({ summary: 'Aktuelle Preise der Leistungen und Einführungsaktion (öffentlich)' })
  info() {
    return this.pricing.publicInfo();
  }

  @Get('me/billing')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigene Buchungen, aktive Leistungen und Nutzungslimits' })
  mine(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    const n = Number(page);
    return this.bookings.myOverview(user, Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1);
  }

  @Get('listings/:id/promotions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buchbare Zusatzleistungen für ein eigenes Inserat' })
  options(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.listingOptions(user, id);
  }

  @Post('listings/:id/bookings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leistung für ein eigenes Inserat buchen (kostenlos sofort aktiv, sonst Stripe Checkout)' })
  @ApiBody({ schema: openApiSchema(createBookingSchema) })
  book(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
    @Req() req: Request,
  ) {
    return this.bookings.create(user, ID.test(id) ? id : '-', body, req.ip);
  }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nach der Rückkehr von Stripe: Zahlungsstatus serverseitig bei Stripe prüfen' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.confirm(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Offene Zahlung abbrechen' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.cancel(user, id);
  }
}
