import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Logger, Module, type DynamicModule } from '@nestjs/common';
import { loadEnv, signingSecret, type Env } from '../config/env.js';
import { LocalStorage } from './local-storage.js';
import { LocalStorageController } from './local-storage.controller.js';
import { r2ConfigFromEnv } from './r2-config.js';
import { createR2Client, R2Storage } from './r2-storage.js';
import { OBJECT_STORAGE, StorageNotConfiguredError, type ObjectStorage } from './storage.types.js';
import { UnconfiguredStorage } from './unconfigured-storage.js';

export const DEFAULT_LOCAL_STORAGE_DIR = fileURLToPath(new URL('../../.storage', import.meta.url));

export function createStorage(env: Env): ObjectStorage {
  if (env.STORAGE_DRIVER === 'local') {
    return new LocalStorage(
      path.resolve(env.LOCAL_STORAGE_DIR ?? DEFAULT_LOCAL_STORAGE_DIR),
      env.API_URL,
      signingSecret(env),
    );
  }
  try {
    const config = r2ConfigFromEnv(env);
    return new R2Storage(createR2Client(config), config.bucket);
  } catch (error) {
    if (!(error instanceof StorageNotConfiguredError)) throw error;
    new Logger('Storage').warn(
      `${error.message} – Bild-Uploads sind deaktiviert (siehe docs/bilder.md).`,
    );
    return new UnconfiguredStorage(error.missing);
  }
}

@Global()
@Module({})
export class StorageModule {
  static forRoot(): DynamicModule {
    const env = loadEnv();
    return {
      module: StorageModule,
      controllers: env.STORAGE_DRIVER === 'local' ? [LocalStorageController] : [],
      providers: [{ provide: OBJECT_STORAGE, useFactory: () => createStorage(env) }],
      exports: [OBJECT_STORAGE],
    };
  }
}
