import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { accountDeletionSchema, type AccountDeletionInput } from '@marktat/shared';
import { AllowSuspended, CurrentUser, Roles } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { DataExportService } from './data-export.service.js';

@ApiTags('Datenschutz')
@ApiBearerAuth()
@Controller()
export class PrivacyController {
  constructor(
    private readonly exports: DataExportService,
    private readonly deletion: AccountDeletionService,
  ) {}

  @Get('me/export')
  @AllowSuspended()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Datenexport (Art. 15/20 DSGVO) als JSON-Datei' })
  async export(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const data = await this.exports.export(user, req.ip);
    res.setHeader('Content-Disposition', `attachment; filename="marktat-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  @Post('me/deletion')
  @AllowSuspended()
  @HttpCode(202)
  // Zusätzlich höchstens 5 falsche Passwörter je Konto und Stunde (AccountDeletionService)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Konto löschen (Art. 17 DSGVO) – Passwort und Bestätigungswort erforderlich' })
  @ApiBody({ schema: openApiSchema(accountDeletionSchema) })
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(accountDeletionSchema)) body: AccountDeletionInput,
    @Req() req: Request,
  ) {
    return this.deletion.request(user, body, req.ip);
  }

  @Post('admin/deletions/:userId/retry')
  @Roles('ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fehlgeschlagene Kontolöschung erneut starten (nur Administratoren)' })
  retry(@CurrentUser() user: AuthUser, @Param('userId', new ParseUUIDPipe()) userId: string, @Req() req: Request) {
    return this.deletion.retry(user, userId, req.ip);
  }
}
