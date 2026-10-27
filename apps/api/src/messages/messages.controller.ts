import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Sse, type MessageEvent } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { defer, interval, map, merge, of, switchMap, type Observable } from 'rxjs';
import {
  reportUserSchema,
  sendMessageSchema,
  type RealtimeEvent,
  type ReportUserInput,
  type SendMessageInput,
} from '@marktat/shared';
import { CurrentUser } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { pageNumber } from '../favorites/favorites.controller.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CONVERSATION_FILTERS, MessagesService, type ConversationFilter } from './messages.service.js';

/** Zusätzlich zu den Grenzwerten je Konto im Service (die gelten über alle Instanzen) */
const SEND_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const HEARTBEAT_MS = 25_000;

@ApiTags('Nachrichten')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  @Post('listings/:listingId/conversations')
  @Throttle(SEND_LIMIT)
  @ApiOperation({ summary: 'Anbieter zu einem Inserat anschreiben (setzt eine bestehende Unterhaltung fort)' })
  @ApiBody({ schema: openApiSchema(sendMessageSchema) })
  start(
    @CurrentUser() user: AuthUser,
    @Param('listingId') listingId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @Req() req: Request,
  ) {
    return this.messages.start(user, listingId, body.body, req.ip);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Eigene Unterhaltungen, neueste zuerst (20 je Seite)' })
  @ApiQuery({ name: 'filter', required: false, enum: CONVERSATION_FILTERS })
  @ApiQuery({ name: 'q', required: false, description: 'Titel des Inserats oder Name der anderen Person' })
  @ApiQuery({ name: 'seite', required: false })
  list(@CurrentUser() user: AuthUser, @Query('filter') filter?: string, @Query('q') q?: string, @Query('seite') page?: string) {
    const valid = CONVERSATION_FILTERS.includes(filter as ConversationFilter) ? (filter as ConversationFilter) : 'alle';
    return this.messages.list(user, { filter: valid, q: typeof q === 'string' ? q : undefined, page: pageNumber(page) });
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Eine Unterhaltung (nur für die beiden Beteiligten)' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.detail(user, id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Nachrichten: ohne Parameter die neuesten 30, before=<id> ältere, after=<id> neuere' })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'after', required: false })
  messagesOf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('before') before?: string, @Query('after') after?: string) {
    return this.messages.messages(user, id, {
      before: typeof before === 'string' ? before : undefined,
      after: typeof after === 'string' ? after : undefined,
    });
  }

  @Post('conversations/:id/messages')
  @Throttle(SEND_LIMIT)
  @ApiOperation({ summary: 'Nachricht senden' })
  @ApiBody({ schema: openApiSchema(sendMessageSchema) })
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.messages.send(user, id, body.body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unterhaltung als gelesen markieren; liefert die verbleibenden ungelesenen Nachrichten' })
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.markRead(user, id);
  }

  @Post('conversations/:id/report')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Die andere Person melden' })
  @ApiBody({ schema: openApiSchema(reportUserSchema) })
  report(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reportUserSchema)) body: ReportUserInput,
    @Req() req: Request,
  ) {
    return this.messages.report(user, id, body, req.ip);
  }

  @Get('me/unread')
  @ApiOperation({ summary: 'Anzahl ungelesener Nachrichten' })
  unread(@CurrentUser() user: AuthUser) {
    return this.messages.unread(user.id);
  }

  @Get('me/blocks')
  @ApiOperation({ summary: 'Von mir blockierte Personen' })
  blocks(@CurrentUser() user: AuthUser) {
    return this.messages.blocks(user);
  }

  @Post('users/:id/block')
  @HttpCode(204)
  @ApiOperation({ summary: 'Person blockieren: keine Nachrichten mehr in beide Richtungen' })
  async block(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.messages.block(user, id, req.ip);
  }

  @Delete('users/:id/block')
  @HttpCode(204)
  @ApiOperation({ summary: 'Blockierung aufheben' })
  async unblock(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    await this.messages.unblock(user, id, req.ip);
  }

  /**
   * Server-Sent Events: neue Nachrichten, Lesebestätigungen, Zähler. Das Web-Frontend reicht die Verbindung
   * über eine eigene Route durch, damit das Access-Token den Server nicht verlässt.
   */
  @Sse('me/events')
  @SkipThrottle()
  @ApiOperation({ summary: 'Echtzeit-Ereignisse (text/event-stream)' })
  events(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return defer(() => this.messages.unread(user.id)).pipe(
      switchMap((unread) =>
        merge(
          of<RealtimeEvent>({ type: 'ready', unread }),
          this.realtime.eventsFor(user.id),
          interval(HEARTBEAT_MS).pipe(map((): RealtimeEvent => ({ type: 'ping' }))),
        ),
      ),
      map((event) => ({ data: event })),
    );
  }
}
