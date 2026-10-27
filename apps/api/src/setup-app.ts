import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { DEAL_IMPORT_MAX_BYTES, MAX_IMAGE_BYTES } from '@marktat/shared';
import { loadEnv } from './config/env.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { requestContext } from './common/request-context.js';
import { ErrorReporter } from './monitoring/error-reporter.js';
import { MAX_MEDIA_BYTES, MEDIA_UPLOAD_PREFIX } from './images/media.js';

export const API_PREFIX = 'v1';

/** Gemeinsame Konfiguration für Server und Tests, damit beide identisch reagieren. */
export function setupApp(app: NestExpressApplication): INestApplication {
  const env = loadEnv();
  app.setGlobalPrefix(API_PREFIX);
  // Anfrage-ID (für Support und Logs) und strukturierte Zugriffslogs ohne Query-Strings und IPs
  app.use(requestContext(env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty')));
  app.use(helmet());
  app.disable('x-powered-by');
  // Hinter einem Load-Balancer: echte Client-IP für Rate-Limits und das (gekürzte) Audit-Log
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  // Die API nutzt Bearer-Tokens statt Cookies – daher kein CSRF-Risiko; CORS nur für das eigene Frontend.
  app.enableCors({
    origin: [env.WEB_URL],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  // Nur der lokale Speichertreiber nimmt Dateien direkt an (in Produktion lädt der Browser direkt zu R2).
  if (env.STORAGE_DRIVER === 'local') {
    app.use(`/${API_PREFIX}/local-storage`, express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }));
  }
  // Stripe-Webhooks brauchen den unveränderten Rohkörper für die Signaturprüfung (vor dem JSON-Parser)
  app.use(`/${API_PREFIX}/billing/stripe/webhook`, express.raw({ type: () => true, limit: '512kb' }));
  // Händlerlogo: Bilddatei als Rohdaten (Prüfung und Umwandlung in der API)
  app.use(`/${API_PREFIX}/me/logo`, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 5 * 1024 * 1024 }));
  // Bilder von Deals und Portfolio (Phase 10): ebenfalls Rohdaten, Prüfung in der API (images/media.ts)
  app.use(`/${API_PREFIX}/${MEDIA_UPLOAD_PREFIX}`, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_MEDIA_BYTES }));
  // CSV-Import der Händler (Phase 10): Datei als Rohdaten, Zeichensatz und Prüfung in der API
  app.use(`/${API_PREFIX}/me/deal-imports`, express.raw({ type: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream'], limit: DEAL_IMPORT_MAX_BYTES }));
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalFilters(new HttpExceptionFilter(app.get(ErrorReporter)));
  app.enableShutdownHooks();
  return app;
}

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('MarktAT API')
    .setDescription('REST-API der Kleinanzeigenplattform MarktAT')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Supabase-Access-Token' })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  return document;
}
