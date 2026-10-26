import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Statische Dateien und Bilder auslassen
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)'],
};
