import type { ReactNode } from 'react';
import { Card } from '@marktat/ui';

export function AuthShell({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-brand-50 to-transparent" />
      <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink-950 sm:text-3xl">{title}</h1>
          {intro ? <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-600">{intro}</p> : null}
          <div className="mt-6">{children}</div>
        </Card>
        {footer ? <div className="mt-6 text-center text-sm text-ink-600">{footer}</div> : null}
      </div>
    </div>
  );
}
