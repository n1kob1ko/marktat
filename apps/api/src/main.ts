import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { setupApp, setupOpenApi } from './setup-app.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  setupApp(app);
  if (env.NODE_ENV !== 'production') setupOpenApi(app);
  await app.listen(env.API_PORT);
  console.log(`MarktAT API läuft auf http://localhost:${env.API_PORT} (Doku: /docs)`);
}
await bootstrap();
