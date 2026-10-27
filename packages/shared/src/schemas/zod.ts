import { z } from 'zod';

// Deutsche Standard-Fehlermeldungen für alle zod-Schemas (Web und API).
// Eigenes Modul, damit zod nur dort im Browser-Bundle landet, wo tatsächlich ein Schema verwendet wird.
z.config(z.locales.de());

export { z };
