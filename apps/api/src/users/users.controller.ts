import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { updateProfileSchema, type UpdateProfileInput } from '@marktat/shared';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { openApiSchema } from '../common/openapi.js';
import { UsersService } from './users.service.js';

@ApiTags('Benutzer')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigenes Profil (wird beim ersten Aufruf angelegt)' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
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

  @Public()
  @Get('users/:id')
  @ApiOperation({ summary: 'Öffentliches Verkäuferprofil' })
  publicProfile(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.getPublicProfile(id);
  }
}
