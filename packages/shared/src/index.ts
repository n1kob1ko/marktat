import { z } from 'zod';

// Deutsche Standard-Fehlermeldungen für alle zod-Schemas (Web und API)
z.config(z.locales.de());

export * from './austria.js';
export * from './enums.js';
export * from './format.js';
export * from './slug.js';
export * from './types.js';
export * from './schemas/auth.js';
export * from './schemas/listing.js';
export * from './schemas/profile.js';
