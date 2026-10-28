import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Nachrichten', robots: { index: false } };

/** Postfach in voller Fensterhöhe: auf dem Desktop Liste und Chat nebeneinander, mobil jeweils eines. */
export default function MessagesLayout({ children }: LayoutProps<'/nachrichten'>) {
  return (
    <div className="mx-auto w-full max-w-7xl lg:px-8 lg:py-6">
      <div className="flex h-[calc(100dvh-6.75rem-1px)] overflow-hidden bg-surface lg:h-[calc(100dvh-9.75rem-1px)] lg:min-h-[32rem] lg:rounded-[var(--radius-card)] lg:border lg:border-line lg:shadow-[var(--shadow-card)]">
        {children}
      </div>
    </div>
  );
}
