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
  @ApiOperation({ summary: 'Welche der angegebenen Inserate gemerkt sind bzw. eigene sind (listingIds=a,b,c; max. 100)' })
  lookup(@CurrentUser() user: AuthUser, @Query('listingIds') listingIds?: string) {
    return this.favorites.lookup(user, (listingIds ?? '').split(',').map((id) => id.trim()));
  }

  @Get('deals')
  @ApiOperation({ summary: 'Gemerkte Deals (24 je Seite, neueste zuerst)' })
  @ApiQuery({ name: 'seite', required: false })
  listDeals(@CurrentUser() user: AuthUser, @Query('seite') page?: string) {
    return this.favorites.listDeals(user, pageNumber(page));
  }

  @Put('deals/:dealId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Deal merken (idempotent)' })
  async addDeal(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) {
    await this.favorites.addDeal(user, dealId);
  }

  @Delete('deals/:dealId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async removeDeal(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) {
    await this.favorites.removeDeal(user, dealId);
  }

  @Get('services')
  @ApiOperation({ summary: 'Gemerkte Anbieterprofile (24 je Seite, neueste zuerst)' })
  @ApiQuery({ name: 'seite', required: false })
  listServices(@CurrentUser() user: AuthUser, @Query('seite') page?: string) {
    return this.favorites.listServices(user, pageNumber(page));
  }

  @Put('services/:profileId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Anbieterprofil merken (idempotent)' })
  async addService(@CurrentUser() user: AuthUser, @Param('profileId') profileId: string) {
    await this.favorites.addService(user, profileId);
  }

  @Delete('services/:profileId')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async removeService(@CurrentUser() user: AuthUser, @Param('profileId') profileId: string) {
    await this.favorites.removeService(user, profileId);
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
