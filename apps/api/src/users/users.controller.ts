import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  notificationSettingsSchema,
  updateProfileSchema,
  type NotificationSettingsInput,
  type UpdateProfileInput,
} from '@marktat/shared';
import { AllowSuspended, CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { openApiSchema } from '../common/openapi.js';
import { UsersService } from './users.service.js';
import { loadEnv, staffMfaRequired } from '../config/env.js';
import { isStaffRole } from '../auth/mfa.guard.js';

@ApiTags('Benutzer')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @AllowSuspended()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigenes Profil (wird beim ersten Aufruf angelegt)' })
  async me(@CurrentUser() user: AuthUser) {
    const env = loadEnv();
    const me = await this.users.getMe(user.id);
    return {
      ...me,
      security: {
        level: user.aal,
        mfaRequired: isStaffRole(user.role) && staffMfaRequired(env),
        stepUpMaxAgeMinutes: env.STEP_UP_MAX_AGE_MINUTES,
      },
    };
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigenes Profil bearbeiten' })
  @ApiBody({ schema: openApiSchema(updateProfileSchema) })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: Request,
  ) {
    return this.users.updateMe(user, body, req.ip);
  }

  @Patch('me/notifications')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'E-Mail-Benachrichtigungen ein- oder ausschalten' })
  @ApiBody({ schema: openApiSchema(notificationSettingsSchema) })
  updateNotifications(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(notificationSettingsSchema)) body: NotificationSettingsInput,
  ) {
    return this.users.updateNotifications(user, body);
  }

  @Public()
  @Get('users/:id')
  @ApiOperation({ summary: 'Öffentliches Verkäuferprofil' })
  publicProfile(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.getPublicProfile(id);
  }
}
