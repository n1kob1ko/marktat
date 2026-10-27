import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { routePattern } from './http-exception.filter.js';

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Setzt X-Request-Id (übernimmt eine gültige ID vom Aufrufer, z. B. vom Proxy) und schreibt im JSON-Format je
 * Anfrage eine Logzeile: Methode, Routenmuster, Status, Dauer. Bewusst ohne Query-String, IP, Token und Pfad-IDs.
 */
export function requestContext(format: 'pretty' | 'json') {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    if (format === 'json') {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const route = routePattern(req);
        // Healthchecks fluten sonst das Log
        if (route.startsWith('/v1/health')) return;
        const line = {
          time: new Date().toISOString(),
          level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
          msg: 'request',
          requestId: id,
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - start) / 1_000_000n),
        };
        process.stdout.write(`${JSON.stringify(line)}\n`);
      });
    }
    next();
  };
}
