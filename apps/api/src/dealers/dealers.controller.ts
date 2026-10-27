import { Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { DealersService } from './dealers.service.js';

export const LOGO_UPLOAD_PATH = 'me/logo';

@ApiTags('Händler')
@Controller()
export class DealersController {
  constructor(private readonly dealers: DealersService) {}

  @Public()
  @Get('dealers/:id')
  @ApiOperation({ summary: 'Öffentliches Händlerprofil mit aktiven Inseraten' })
  profile(@Param('id', new ParseUUIDPipe()) id: string, @Query('seite') page?: string) {
    const n = Number(page);
    return this.dealers.profile(id, Number.isInteger(n) && n >= 1 && n <= 400 ? n : 1);
  }

  @Public()
  @SkipThrottle()
  @Get('dealers/:id/logo')
  @ApiOperation({ summary: 'Händlerlogo (Weiterleitung auf den Bildspeicher)' })
  async logo(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const url = await this.dealers.logoDownload(id);
    if (!url) throw new NotFoundException('Kein Logo vorhanden.');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(302, url);
  }

  @Put(LOGO_UPLOAD_PATH)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logo hochladen (Rohdaten: JPEG, PNG oder WebP, max. 5 MB)' })
  upload(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.dealers.uploadLogo(user, req.body, req.ip);
  }

  @Delete(LOGO_UPLOAD_PATH)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logo entfernen' })
  remove(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.dealers.deleteLogo(user, req.ip);
  }
}
