import type { ReactNode } from 'react';
import { Alert, Container } from '@marktat/ui';

/** Rahmen für Rechtstexte. Jeder Text trägt den Prüfhinweis, bis eine Rechtsberatung ihn freigibt. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">{title}</h1>
      <Alert tone="warning" className="mt-6" title="Entwurf – rechtlich noch nicht geprüft">
        Dieser Text ist ein Platzhalter und muss vor dem öffentlichen Start von einer österreichischen Rechtsberatung
        geprüft und vervollständigt werden.
      </Alert>
      <div className="mt-8 space-y-4 text-[0.9375rem] leading-relaxed text-ink-800 [&_h2]:mt-8 [&_h2]:font-sans [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-normal [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </Container>
  );
}
