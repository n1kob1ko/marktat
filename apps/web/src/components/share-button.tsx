'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Link2, Mail, MessageCircle, Share2 } from 'lucide-react';
import { Swap, cn } from '@marktat/ui';
import { usePresence } from '@/lib/motion';

interface ShareButtonProps {
  /** Vollständige Adresse der Seite, z. B. https://markterl.at/anzeige/abc */
  url: string;
  title: string;
  /** Kurzer Text für WhatsApp und E-Mail, z. B. „Gefunden auf Markterl“ */
  text?: string;
  className?: string;
}

/**
 * „Teilen“: am Handy das Teilen-Menü des Geräts (WhatsApp, Signal, Nachrichten …), sonst eine kleine Auswahl
 * mit WhatsApp, Facebook, E-Mail und „Link kopieren“.
 */
export function ShareButton({
  url,
  title,
  text = 'Gefunden auf Markterl',
  className,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuId = useId();
  const menu = usePresence(open);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function share() {
    // Teilen-Menü des Geräts nur auf Touch-Geräten; am Desktop ist die eigene Auswahl übersichtlicher
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, text: `${title} – ${text}`, url });
        return;
      } catch (error) {
        // Abgebrochen: nichts tun; anderer Fehler: eigene Auswahl zeigen
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    setOpen((value) => !value);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Link kopieren:', url);
    }
  }

  const message = encodeURIComponent(`${title} – ${text}: ${url}`);
  const item =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[0.9375rem] text-ink-800 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-brand-500';

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        onClick={share}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="press inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-[0.9375rem] font-semibold text-ink-700 hover:border-ink-400 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <Share2 className="size-5" aria-hidden="true" />
        <span>Teilen</span>
      </button>
      {menu.present ? (
        <div
          id={menuId}
          role="group"
          aria-label="Teilen über"
          data-state={menu.state}
          className="pop stagger settle absolute right-0 z-30 mt-2 w-60 origin-top-right rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <a
            className={item}
            href={`https://wa.me/?text=${message}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-5 text-[#25d366]" aria-hidden="true" /> WhatsApp
          </a>
          <a
            className={item}
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Share2 className="size-5 text-[#1877f2]" aria-hidden="true" /> Facebook
          </a>
          <a className={item} href={`mailto:?subject=${encodeURIComponent(title)}&body=${message}`}>
            <Mail className="size-5 text-ink-500" aria-hidden="true" /> E-Mail
          </a>
          <button type="button" className={item} onClick={copy}>
            <Swap
              active={copied}
              on={<Check className={cn('size-5 text-brand-700', copied && 'confirm')} aria-hidden="true" />}
              off={<Link2 className="size-5 text-ink-500" aria-hidden="true" />}
            />
            <Swap kind="text" active={copied} on="Link kopiert" off="Link kopieren" className="justify-items-start" />
          </button>
          <span role="status" className="sr-only">
            {copied ? 'Link kopiert' : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
}
