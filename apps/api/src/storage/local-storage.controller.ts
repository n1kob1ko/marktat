import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators.js';
import { LocalStorage } from './local-storage.js';
import { OBJECT_STORAGE } from './storage.types.js';

/**
 * Gegenstück zu R2-Presigned-URLs für den lokalen Speichertreiber. Nur aktiv mit STORAGE_DRIVER=local.
 * Der Request-Body kommt als Buffer (express.raw, siehe setup-app.ts).
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('local-storage')
export class LocalStorageController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: LocalStorage) {}

  @Put(':token')
  @HttpCode(200)
  async upload(@Param('token') token: string, @Req() req: Request) {
    const payload = this.storage.verify(token, 'put');
    if (!payload) throw new ForbiddenException('Upload-URL ungültig oder abgelaufen.');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body)) throw new BadRequestException('Leerer Upload.');
    if (req.headers['content-type'] !== payload.contentType) {
      throw new ForbiddenException('Content-Type passt nicht zur Signatur.');
    }
    if (body.length !== payload.contentLength)
      throw new ForbiddenException('Dateigröße passt nicht zur Signatur.');
    await this.storage.put(payload.key, body, payload.contentType!);
    return { ok: true };
  }

  @Get(':token')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async download(@Param('token') token: string, @Res() res: Response) {
    const payload = this.storage.verify(token, 'get');
    if (!payload) throw new ForbiddenException('Download-URL ungültig oder abgelaufen.');
    const meta = await this.storage.head(payload.key);
    if (!meta) throw new NotFoundException();
    const body = await this.storage.getBytes(payload.key, Number.MAX_SAFE_INTEGER);
    res.setHeader('Content-Type', meta.contentType ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(body);
  }
}
