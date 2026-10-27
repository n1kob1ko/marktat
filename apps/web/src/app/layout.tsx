import type { Metadata, Viewport } from 'next';
import { serverEnv } from '@/lib/env';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  metadataBase: new URL(serverEnv.webUrl),
  title: {
    default: 'MarktAT – Kleinanzeigen für Österreich',
    template: '%s | MarktAT',
  },
  description:
    'Kostenlos inserieren und Schnäppchen finden: Marktplatz, Auto & Motor, Immobilien und Jobs in ganz Österreich.',
  applicationName: 'MarktAT',
  openGraph: { type: 'website', locale: 'de_AT', siteName: 'MarktAT' },
  // Vor dem offiziellen Start nicht indexieren (ALLOW_INDEXING, siehe next.config.ts)
  ...(serverEnv.allowIndexing ? {} : { robots: { index: false, follow: false } }),
};

export const viewport: Viewport = {
  themeColor: '#0f4c3a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de-AT" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:shadow-lg"
        >
          Zum Inhalt springen
        </a>
        <SiteHeader />
        <main id="inhalt" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
