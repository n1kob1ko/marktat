'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '@marktat/ui';
import { PORTFOLIO_IMAGE_RIGHTS, PORTFOLIO_IMAGE_RIGHTS_LABELS, type PortfolioImageRights } from '@marktat/shared';

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Profilbild bzw. Bild eines Portfolio-Eintrags. Vor dem Hochladen muss angegeben werden, woher das Bild stammt;
 * fremde Bilder ohne Nutzungsrecht sind nicht erlaubt. Bei lizenzierten Bildern ist die Quelle Pflicht.
 */
export function ServiceImageUpload({
  endpoint,
  imageUrl,
  rights,
  credit,
  label,
  round = false,
}: {
  /** z. B. `/api/medien/dienstleistungen` oder `/api/medien/dienstleistungen/portfolio/<id>` */
  endpoint: string;
  imageUrl: string | null;
  rights: PortfolioImageRights | null;
  credit: string | null;
  label: string;
  round?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [selectedRights, setSelectedRights] = useState<PortfolioImageRights | ''>(rights ?? '');
  const [source, setSource] = useState(credit ?? '');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const needsSource = selectedRights === 'LICENSED';

  const send = (method: 'PUT' | 'DELETE', file?: File) =>
    startTransition(async () => {
      setMessage(null);
      const query = method === 'PUT' ? `?${new URLSearchParams({ rechte: selectedRights, quelle: source.trim() })}` : '';
      const response = await fetch(`${endpoint}${query}`, {
        method,
        body: file,
        headers: file ? { 'Content-Type': file.type } : undefined,
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { message?: string } | null;
      if (!response?.ok) {
        setMessage({ tone: 'danger', text: data?.message ?? 'Das hat nicht geklappt. Bitte versuche es erneut.' });
        return;
      }
      setMessage({ tone: 'success', text: method === 'PUT' ? 'Das Bild ist gespeichert.' : 'Das Bild wurde entfernt.' });
      router.refresh();
    });

  const pick = () => {
    if (!selectedRights) {
      setMessage({ tone: 'danger', text: 'Bitte gib zuerst an, woher das Bild stammt.' });
      return;
    }
    if (needsSource && source.trim().length < 2) {
      setMessage({ tone: 'danger', text: 'Bitte gib bei lizenzierten Bildern die Quelle an.' });
      return;
    }
    input.current?.click();
  };

  const frame = round ? 'size-24 rounded-full' : 'h-24 w-32 rounded-xl';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Bild ist serverseitig verkleinert (WebP)
          <img src={imageUrl} alt={label} width={128} height={96} className={`${frame} border border-line bg-surface object-cover`} />
        ) : (
          <span className={`${frame} flex items-center justify-center bg-canvas text-ink-300`}>
            <ImageIcon className="size-7" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <Field label="Herkunft des Bildes" required>
            <Select value={selectedRights} onChange={(e) => setSelectedRights(e.target.value as PortfolioImageRights | '')}>
              <option value="">Bitte wählen</option>
              {PORTFOLIO_IMAGE_RIGHTS.map((r) => (
                <option key={r} value={r}>{PORTFOLIO_IMAGE_RIGHTS_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          {needsSource ? (
            <Field label="Quelle bzw. Urheber" hint="Wird unter dem Bild angezeigt" required>
              <Input value={source} maxLength={120} onChange={(e) => setSource(e.target.value)} />
            </Field>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`${label} auswählen`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (file.size > MAX_BYTES) {
            setMessage({ tone: 'danger', text: 'Das Bild darf höchstens 15 MB groß sein.' });
            return;
          }
          send('PUT', file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" loading={pending} onClick={pick}>
          {imageUrl ? 'Bild ersetzen' : 'Bild hochladen'}
        </Button>
        {imageUrl ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => send('DELETE')}>
            Entfernen
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-ink-500">
        JPEG, PNG oder WebP bis 15 MB. Nur eigene Bilder, Arbeiten mit Erlaubnis der Kund:innen oder lizenzierte Bilder – keine Bilder aus fremden Websites.
      </p>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}
