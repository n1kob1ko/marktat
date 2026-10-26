'use client';

import { Button, Container } from '@marktat/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-20 text-center">
      <h1 className="text-2xl font-bold text-ink-950">Da ist etwas schiefgelaufen</h1>
      <p className="mt-2 text-ink-600">Bitte versuche es noch einmal. Wenn der Fehler bleibt, sind wir schon dran.</p>
      <Button className="mt-8" onClick={reset}>Erneut versuchen</Button>
    </Container>
  );
}
