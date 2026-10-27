import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { setupApp, setupOpenApi } from './setup-app.js';

async function bootstrap() {
  const env = loadEnv();
  // Produktion: eine JSON-Zeile je Logeintrag (für Log-Sammler); lokal lesbar mit Farben
  const json = (env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new ConsoleLogger({ json, colors: !json }),
  });
  setupApp(app);
  if (env.NODE_ENV !== 'production') setupOpenApi(app);
  await app.listen(env.API_PORT);
  new Logger('Start').log(`MarktAT API läuft auf Port ${env.API_PORT}${env.NODE_ENV !== 'production' ? ' (Doku: /docs)' : ''}`);
}
await bootstrap();
