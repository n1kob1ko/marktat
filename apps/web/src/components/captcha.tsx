'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

/** Öffentlicher Site-Key; ohne ihn gibt es kein Captcha (lokal, Tests) */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const CAPTCHA_FIELD = 'cf-turnstile-response';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

/**
 * Cloudflare Turnstile (Bot-Schutz) für Registrierung, Anmeldung und Passwort-Reset. Das Widget schreibt den
 * Prüfwert in ein verstecktes Feld (`cf-turnstile-response`), das die Server Action an Supabase Auth weitergibt.
 * Meist läuft die Prüfung unsichtbar; nur im Zweifel erscheint eine kleine Aufgabe.
 */
export function Captcha({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const el = host.current;
    const mount = () => {
      if (!el || widgetId.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        language: 'de',
        appearance: 'interaction-only',
        'response-field-name': CAPTCHA_FIELD,
        // Prüfwerte gelten einmalig; nach einem Fehler im Formular ein neuer
        'expired-callback': () => widgetId.current && window.turnstile?.reset(widgetId.current),
      });
    };
    mount();
    const timer = window.setInterval(() => {
      mount();
      if (widgetId.current) window.clearInterval(timer);
    }, 200);
    return () => {
      window.clearInterval(timer);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" />
      <div ref={host} className={className} data-testid="captcha" />
    </>
  );
}
