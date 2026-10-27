import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { MAX_IMAGE_BYTES } from '@marktat/shared';
import { loadEnv } from './config/env.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

export const API_PREFIX = 'v1';

/** Gemeinsame Konfiguration für Server und Tests, damit beide identisch reagieren. */
export function setupApp(app: NestExpressApplication): INestApplication {
  const env = loadEnv();
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.disable('x-powered-by');
  // Hinter einem Load-Balancer: echte Client-IP für Rate-Limits und das (gekürzte) Audit-Log
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  // Die API nutzt Bearer-Tokens statt Cookies – daher kein CSRF-Risiko; CORS nur für das eigene Frontend.
  app.enableCors({
    origin: [env.WEB_URL],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  // Nur der lokale Speichertreiber nimmt Dateien direkt an (in Produktion lädt der Browser direkt zu R2).
  if (env.STORAGE_DRIVER === 'local') {
    app.use(`/${API_PREFIX}/local-storage`, express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }));
  }
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalFilters(new HttpExceptionFilter());
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
