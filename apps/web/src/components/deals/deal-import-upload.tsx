'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { Alert, Button } from '@marktat/ui';
import { DEAL_IMPORT_MAX_BYTES } from '@marktat/shared';

/** CSV-Datei auswählen und hochladen; danach geht es zur Vorschau (dort wird noch nichts übernommen) */
export function DealImportUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (file: File) =>
    startTransition(async () => {
      setError(null);
      if (file.size > DEAL_IMPORT_MAX_BYTES) {
        setError('Die Datei darf höchstens 2 MB groß sein. Teile sie bitte auf.');
        return;
      }
      const response = await fetch(`/api/deals/importe?${new URLSearchParams({ datei: file.name })}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'text/csv' },
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { message?: string; id?: string } | null;
      if (!response?.ok || !data?.id) {
        setError(data?.message ?? 'Das hat nicht geklappt. Bitte versuche es erneut.');
        return;
      }
      router.push(`/konto/deals/import/${data.id}`);
    });

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="CSV-Datei auswählen"
        data-testid="deal-import-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />
      <Button type="button" onClick={() => input.current?.click()} loading={pending}>
        <FileUp className="size-4" aria-hidden="true" /> CSV-Datei hochladen
      </Button>
      <p className="text-xs text-ink-500">Höchstens 2 MB und 1000 Zeilen. Du siehst zuerst eine Vorschau – übernommen wird erst nach deiner Bestätigung.</p>
    </div>
  );
}
