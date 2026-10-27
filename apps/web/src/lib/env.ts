/**
 * Serverseitige Konfiguration. `next.config.ts` lädt die gemeinsame Root-.env in den Serverprozess;
 * NEXT_PUBLIC_*-Werte werden zusätzlich zur Build-Zeit in Client-Bundles eingesetzt.
 */
export const serverEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost:54321',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:4000',
  webUrl: process.env.NEXT_PUBLIC_WEB_URL || process.env.WEB_URL || 'http://localhost:3000',
  /** Suchmaschinen zulassen (erst nach dem Start; wird beim Build festgelegt, siehe next.config.ts) */
  allowIndexing: process.env.ALLOW_INDEXING === 'true',
};
