import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AutofillService } from './autofill.service.js';

/** Pfad, für den setup-app.ts Rohdaten (Bilddatei) statt JSON annimmt */
export const AUTOFILL_UPLOAD_PATH = 'autofill/listing';

@ApiTags('Foto-Assistent')
@Controller()
export class AutofillController {
  constructor(private readonly autofill: AutofillService) {}

  @Get('autofill/status')
  @Public()
  @ApiOperation({ summary: 'Ist der Foto-Assistent eingeschaltet?' })
  status() {
    return this.autofill.status();
  }

  @Post(AUTOFILL_UPLOAD_PATH)
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Foto auswerten (Rohdaten: JPEG, PNG oder WebP) – liefert Vorschläge für Kategorie, Titel, Beschreibung und Zusatzangaben',
  })
  suggest(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.autofill.suggest(user, req.body, req.headers['content-type']);
  }
}
