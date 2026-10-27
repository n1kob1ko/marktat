import { z } from 'zod';

// Deutsche Standard-Fehlermeldungen für alle zod-Schemas (Web und API)
z.config(z.locales.de());

export * from './austria.js';
export * from './billing.js';
export * from './attributes/index.js';
export * from './enums.js';
export * from './format.js';
export * from './slug.js';
export * from './types.js';
export * from './schemas/auth.js';
export * from './schemas/billing.js';
export * from './schemas/image.js';
export * from './schemas/interactions.js';
export * from './schemas/listing.js';
export * from './schemas/moderation.js';
export * from './schemas/profile.js';
export * from './search/index.js';
