import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createSavedSearchSchema,
  updateSavedSearchSchema,
  type CreateSavedSearchInput,
  type UpdateSavedSearchInput,
} from '@marktat/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SavedSearchesService } from './saved-searches.service.js';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Gespeicherte Suchen')
@ApiBearerAuth()
@Controller('me/searches')
export class SavedSearchesController {
  constructor(private readonly searches: SavedSearchesService) {}

  @Get()
  @ApiOperation({ summary: 'Gespeicherte Suchen (neueste zuerst)' })
  list(@CurrentUser() user: AuthUser) {
    return this.searches.list(user);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Suche speichern (Parameter wie in der Such-URL; doppelte Suchen ergeben 409)' })
  @ApiBody({ schema: openApiSchema(createSavedSearchSchema) })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSavedSearchSchema)) body: CreateSavedSearchInput) {
    return this.searches.create(user, body);
  }

  @Patch(':id')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Umbenennen bzw. Benachrichtigung ein- oder ausschalten' })
  @ApiBody({ schema: openApiSchema(updateSavedSearchSchema) })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSavedSearchSchema)) body: UpdateSavedSearchInput,
  ) {
    return this.searches.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Gespeicherte Suche löschen' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.searches.remove(user, id);
  }
}
