import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { mfaEventSchema, type MfaEventInput } from '@marktat/shared';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { StepUp } from '../auth/mfa.guard.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MfaService } from './mfa.service.js';

const LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Sicherheit')
@ApiBearerAuth()
@Controller()
export class SecurityController {
  constructor(private readonly mfa: MfaService) {}

  // Bewusst ohne @Roles: Teammitglieder ohne 2FA müssen die Einrichtung erreichen (sonst Henne-Ei-Problem).
  @Post('me/mfa/events')
  @HttpCode(200)
  @Throttle(LIMIT)
  @ApiOperation({ summary: 'Änderung der eigenen 2FA protokollieren (Stand wird aus Supabase gelesen)' })
  @ApiBody({ schema: openApiSchema(mfaEventSchema) })
  event(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(mfaEventSchema)) body: MfaEventInput, @Req() req: Request) {
    return this.mfa.recordChange(user, body.event, req.ip);
  }

  @Get('admin/users/:id/mfa')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Bestätigte 2FA-Faktoren eines Kontos (ohne Geheimnisse)' })
  factors(@Param('id') id: string) {
    return this.mfa.factorsFor(id);
  }

  @Post('admin/users/:id/mfa/reset')
  @HttpCode(200)
  @Roles('ADMIN')
  @StepUp()
  @Throttle(LIMIT)
  @ApiOperation({ summary: '2FA eines anderen Kontos zurücksetzen (z. B. Gerät verloren)' })
  reset(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.mfa.reset(admin, id, req.ip);
  }
}
