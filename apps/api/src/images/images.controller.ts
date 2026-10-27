import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { ImageUrls } from './image-urls.js';
import { ListingImagesService } from './listing-images.service.js';

/**
 * Stabile Bild-URLs. Leitet auf eine kurzlebige, signierte R2-URL der verarbeiteten Variante um.
 * Unverarbeitete Uploads sind hierüber nie erreichbar; der Bucket selbst bleibt privat.
 */
@ApiTags('Inseratsbilder')
@Public()
// Eine Ergebnisseite lädt viele Vorschaubilder; die Abfrage ist billig (ein Indexzugriff + lokale Signatur).
@SkipThrottle()
@Controller('images')
export class ImagesController {
  constructor(
    private readonly images: ListingImagesService,
    private readonly urls: ImageUrls,
  ) {}

  @Get(':imageId/:variant')
  @ApiOperation({
    summary: 'Bild ausliefern (Varianten: large, thumb) – Weiterleitung auf den Bildspeicher',
  })
  async show(
    @Param('imageId') imageId: string,
    @Param('variant') variant: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const target = await this.images.resolveDownload(imageId, variant, (v) =>
      this.urls.verify(imageId, v, exp, sig),
    );
    if (!target) throw new NotFoundException('Dieses Bild gibt es nicht.');
    // Kürzer als die Gültigkeit der Ziel-URL (1 h), damit eine zwischengespeicherte Weiterleitung nie ins Leere führt.
    res.setHeader('Cache-Control', `${target.isPublic ? 'public' : 'private'}, max-age=1800`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(302, target.url);
  }
}
