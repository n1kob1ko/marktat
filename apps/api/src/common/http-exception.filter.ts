import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Einheitliches Fehlerformat: { statusCode, message, errors? }.
 * Interne Details (Stacktraces, SQL, Prisma-Meldungen) gehen nur ins Log, nie an den Client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const { message, errors } = body as { message: unknown; errors?: unknown };
        return response.status(status).json({
          statusCode: status,
          message: Array.isArray(message) ? message.join(' ') : String(message),
          ...(errors ? { errors } : {}),
        });
      }
      return response.status(status).json({ statusCode: status, message: String(body) });
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return response
          .status(HttpStatus.NOT_FOUND)
          .json({ statusCode: 404, message: 'Der Eintrag wurde nicht gefunden.' });
      }
      if (exception.code === 'P2002') {
        return response
          .status(HttpStatus.CONFLICT)
          .json({ statusCode: 409, message: 'Der Eintrag existiert bereits.' });
      }
    }

    // Nur Methode und Pfad ohne Query-String loggen – Query kann personenbezogene Daten enthalten.
    this.logger.error(
      `${request.method} ${request.path} fehlgeschlagen`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.',
    });
  }
}
