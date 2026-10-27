import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { Prisma } from '../generated/prisma/client.js';
import { StorageNotConfiguredError } from '../storage/storage.types.js';
import type { ErrorReporter } from '../monitoring/error-reporter.js';

/**
 * Einheitliches Fehlerformat: { statusCode, message, errors? }.
 * Interne Details (Stacktraces, SQL, Prisma-Meldungen) gehen nur ins Log, nie an den Client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  constructor(private readonly reporter?: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const { message, errors, code } = body as { message: unknown; errors?: unknown; code?: unknown };
        return response.status(status).json({
          statusCode: status,
          message: Array.isArray(message) ? message.join(' ') : String(message),
          ...(errors ? { errors } : {}),
          ...(typeof code === 'string' ? { code } : {}),
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

    if (exception instanceof StorageNotConfiguredError) {
      this.logger.warn(exception.message);
      return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: 503,
        message: 'Der Bild-Upload ist derzeit nicht verfügbar.',
      });
    }

    if (exception instanceof S3ServiceException) {
      // Code und Status reichen zur Diagnose; die Meldung kann Bucket- oder Schlüsselnamen enthalten.
      this.logger.error(`${request.method} ${request.route?.path ?? request.path}: Objektspeicher ${exception.name} (${exception.$metadata.httpStatusCode})`);
      return response.status(HttpStatus.BAD_GATEWAY).json({
        statusCode: 502,
        message: 'Der Bildspeicher ist gerade nicht erreichbar. Bitte versuche es später erneut.',
      });
    }

    // Nur Methode und Routenmuster loggen – Pfad-IDs und Query können personenbezogene Daten enthalten.
    const route = `${request.method} ${routePattern(request)}`;
    const requestId = response.getHeader('x-request-id') as string | undefined;
    if (this.reporter) {
      this.reporter.capture(exception, { source: 'http', route, requestId });
    } else {
      this.logger.error(`${route} fehlgeschlagen`, exception instanceof Error ? exception.stack : String(exception));
    }
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.',
      ...(requestId ? { requestId } : {}),
    });
  }
}

/** Routenmuster wie „/v1/listings/:id“ statt des konkreten Pfads; unbekannte Routen ohne IDs */
export function routePattern(request: Request): string {
  const route = (request.route as { path?: string } | undefined)?.path;
  if (route) return `${request.baseUrl ?? ''}${route}`;
  return request.path.replace(/\/[^/]*\d[^/]*/g, '/:param').slice(0, 120);
}
