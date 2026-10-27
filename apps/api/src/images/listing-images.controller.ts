import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createImageUploadSchema,
  reorderImagesSchema,
  type CreateImageUploadInput,
  type ReorderImagesInput,
} from '@marktat/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { openApiSchema } from '../common/openapi.js';
import { ListingImagesService } from './listing-images.service.js';

/** 10 Bilder × (Anmelden + Abschließen) plus Wiederholungen sollen in eine Minute passen. */
const IMAGE_WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Inseratsbilder')
@ApiBearerAuth()
@Controller('listings/:listingId/images')
export class ListingImagesController {
  constructor(private readonly images: ListingImagesService) {}

  @Get()
  @ApiOperation({
    summary: 'Fertige Bilder des eigenen Inserats in Anzeigereihenfolge (erstes = Hauptbild)',
  })
  list(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.images.list(user, listingId);
  }

  @Post('uploads')
  @Throttle(IMAGE_WRITE_LIMIT)
  @ApiOperation({ summary: 'Upload anmelden: liefert eine 5 Minuten gültige, signierte PUT-URL' })
  @ApiBody({ schema: openApiSchema(createImageUploadSchema) })
  createUpload(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body(new ZodValidationPipe(createImageUploadSchema)) body: CreateImageUploadInput,
  ) {
    return this.images.createUpload(user, listingId, body);
  }

  @Post(':imageId/complete')
  @HttpCode(200)
  @Throttle(IMAGE_WRITE_LIMIT)
  @ApiOperation({ summary: 'Upload abschließen: Datei prüfen, EXIF entfernen, Varianten erzeugen' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ) {
    return this.images.complete(user, listingId, imageId, req.ip);
  }

  @Put('order')
  @Throttle(IMAGE_WRITE_LIMIT)
  @ApiOperation({ summary: 'Reihenfolge festlegen (erstes Bild = Hauptbild)' })
  @ApiBody({ schema: openApiSchema(reorderImagesSchema) })
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body(new ZodValidationPipe(reorderImagesSchema)) body: ReorderImagesInput,
    @Req() req: Request,
  ) {
    return this.images.reorder(user, listingId, body.imageIds, req.ip);
  }

  @Post(':imageId/main')
  @HttpCode(200)
  @Throttle(IMAGE_WRITE_LIMIT)
  @ApiOperation({ summary: 'Bild als Hauptbild festlegen' })
  setMain(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ) {
    return this.images.setMain(user, listingId, imageId, req.ip);
  }

  @Delete(':imageId')
  @HttpCode(204)
  @Throttle(IMAGE_WRITE_LIMIT)
  @ApiOperation({ summary: 'Bild löschen' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
  ) {
    await this.images.remove(user, listingId, imageId, req.ip);
  }
}
