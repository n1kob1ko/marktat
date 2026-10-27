'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button, Container } from '@marktat/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  // reset() allein rendert nur neu; refresh() holt die Serverdaten erneut (z. B. nach einer kurzen Störung)
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <Container className="py-20 text-center">
      <h1 className="text-2xl font-bold text-ink-950">Da ist etwas schiefgelaufen</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-600">
        Die Seite konnte gerade nicht geladen werden. Bitte versuche es noch einmal – meist ist eine Störung nach wenigen Minuten behoben.
      </p>
      <Button className="mt-8" onClick={retry} loading={retrying}>
        Erneut versuchen
      </Button>
    </Container>
  );
}
