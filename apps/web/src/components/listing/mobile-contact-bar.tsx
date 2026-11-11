'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { buttonClasses } from '@marktat/ui';

/**
 * Fester Balken am unteren Rand (nur unter 1024 px): Preis und „Nachricht schreiben“ bleiben beim Scrollen
 * sichtbar. Sobald der Kontakt-Knopf bzw. das Formular (#kontakt-aktion) im Bild ist, verschwindet der Balken.
 * Er verdoppelt nur den Knopf aus der Seite – für Vorlesesoftware und Tastatur bleibt er deshalb unsichtbar,
 * damit es den Kontakt nicht zweimal gibt.
 */
export function MobileContactBar({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const [contactVisible, setContactVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById('kontakt-aktion');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setContactVisible(Boolean(entry?.isIntersecting)), { threshold: 0.6 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-testid="mobile-contact-bar"
      aria-hidden="true"
      className={[
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur transition-transform ease-out supports-[backdrop-filter]:bg-surface/85 lg:hidden',
        'pb-[max(0.625rem,env(safe-area-inset-bottom))]',
        // Verschwinden 20 % kürzer als Erscheinen
        contactVisible ? 'pointer-events-none translate-y-full duration-200' : 'translate-y-0 duration-[250ms]',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-2.5">
        <div className="min-w-0">{children}</div>
        <Link href={href} className={buttonClasses({ size: 'lg', className: 'shrink-0' })} tabIndex={-1}>
          <MessageCircle className="size-5" aria-hidden="true" /> {label}
        </Link>
      </div>
    </div>
  );
}
