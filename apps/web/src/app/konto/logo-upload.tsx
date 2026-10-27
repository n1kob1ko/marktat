'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Store } from 'lucide-react';
import { Alert, Button } from '@marktat/ui';

/** Firmenlogo für Händlerprofil und Anzeigen (JPEG, PNG oder WebP bis 5 MB, wird auf 400 px verkleinert). */
export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (method: 'PUT' | 'DELETE', file?: File) =>
    startTransition(async () => {
      setMessage(null);
      const response = await fetch('/api/logo', { method, body: file, headers: file ? { 'Content-Type': file.type } : undefined }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { message?: string } | null;
      if (!response?.ok) {
        setMessage({ tone: 'danger', text: data?.message ?? 'Das hat nicht geklappt. Bitte versuche es erneut.' });
        return;
      }
      setMessage({ tone: 'success', text: method === 'PUT' ? 'Dein Logo ist gespeichert.' : 'Das Logo wurde entfernt.' });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Logo ist serverseitig verkleinert (WebP)
          <img src={logoUrl} alt="Aktuelles Logo" width={64} height={64} className="size-16 rounded-xl border border-line bg-surface object-contain" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Store className="size-7" aria-hidden="true" />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Logo auswählen"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setMessage({ tone: 'danger', text: 'Das Logo darf höchstens 5 MB groß sein.' });
                return;
              }
              send('PUT', file);
            }}
          />
          <Button variant="outline" size="sm" loading={pending} onClick={() => input.current?.click()}>
            {logoUrl ? 'Logo ändern' : 'Logo hochladen'}
          </Button>
          {logoUrl ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => send('DELETE')}>
              Entfernen
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-ink-500">JPEG, PNG oder WebP, mindestens 64 × 64 Pixel, höchstens 5 MB.</p>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}
