import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('System')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Lebenszeichen inkl. Datenbankverbindung' })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Datenbank nicht erreichbar.');
    }
    return { status: 'ok', database: 'ok' };
  }
}
