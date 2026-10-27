import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FavoritesService } from './favorites.service.js';

const WRITE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@ApiTags('Merkliste')
@ApiBearerAuth()
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Merkliste (24 je Seite, neueste zuerst)' })
  @ApiQuery({ name: 'seite', required: false })
  list(@CurrentUser() user: AuthUser, @Query('seite') page?: string) {
    return this.favorites.list(user, pageNumber(page));
  }

  @Get('ids')
  @ApiOperation({ summary: 'Welche der angegebenen Inserate gemerkt sind (listingIds=a,b,c; max. 100)' })
  async lookup(@CurrentUser() user: AuthUser, @Query('listingIds') listingIds?: string) {
    return { listingIds: await this.favorites.lookup(user, (listingIds ?? '').split(',').map((id) => id.trim())) };
  }

  @Put(':listingId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Inserat merken (idempotent)' })
  async add(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    await this.favorites.add(user, listingId);
  }

  @Delete(':listingId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Inserat von der Merkliste entfernen (idempotent)' })
  async remove(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    await this.favorites.remove(user, listingId);
  }
}

/** Seitenzahl aus der URL; Unsinn ergibt Seite 1 */
export function pageNumber(value: string | undefined, max = 1000): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= max ? page : 1;
}
