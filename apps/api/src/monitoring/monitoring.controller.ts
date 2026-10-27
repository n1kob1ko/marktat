import { Controller, Delete, Get, HttpCode, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public, Roles } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

@ApiTags('System')
@Controller()
export class MonitoringController {
  constructor(
    private readonly health: HealthService,
    private readonly prisma: PrismaService,
  ) {}

  /** Lebenszeichen für Load-Balancer und Docker: 200 nur mit erreichbarer Datenbank (Format unverändert seit Phase 1) */
  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({ summary: 'Lebenszeichen inkl. Datenbankverbindung' })
  async live(@Res({ passthrough: true }) res: Response) {
    const database = await this.health.database();
    if (database.status !== 'ok') {
      res.status(503);
      return { statusCode: 503, message: 'Datenbank nicht erreichbar.' };
    }
    return { status: 'ok', database: 'ok' };
  }

  /**
   * Bereitschaft mit allen Abhängigkeiten. Öffentlich nur der Zustand je Komponente (keine Latenzen,
   * keine Fehlermeldungen). 503 nur, wenn eine kritische Komponente (Datenbank) fehlt.
   */
  @Public()
  @SkipThrottle()
  @Get('health/ready')
  @ApiOperation({ summary: 'Bereitschaft: Datenbank, Redis, Suche, Auth, E-Mail' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = await this.health.checks();
    const status = HealthService.overall(checks);
    if (status === 'down') res.status(503);
    return { status, checks: Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.status])) };
  }

  @Get('admin/system')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Systemzustand mit Latenzen, Aufträgen und Fehlerübersicht (nur Administratoren)' })
  system() {
    return this.health.system();
  }

  @Delete('admin/system/errors/:id')
  @HttpCode(204)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fehlereintrag als erledigt entfernen (tritt er wieder auf, erscheint er neu)' })
  async resolve(@Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) return;
    await this.prisma.errorEvent.deleteMany({ where: { id: BigInt(id) } });
  }
}
