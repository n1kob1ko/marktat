import type { ReactNode } from 'react';
import Image from 'next/image';
import { Card } from '@marktat/ui';
import handoverPhoto from '@/assets/bilder/uebergabe-haustuer.jpg';

export function AuthShell({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative isolate overflow-hidden">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-brand-50 to-transparent" />
      {/* Ab großen Bildschirmen steht neben dem Formular ein Foto, am Handy und Tablet bleibt nur das Formular */}
      <div className="mx-auto grid w-full max-w-md items-start gap-10 px-4 py-12 sm:py-16 lg:max-w-5xl lg:grid-cols-[minmax(0,28rem)_1fr]">
        <div>
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-ink-950 sm:text-3xl">{title}</h1>
            {intro ? <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-600">{intro}</p> : null}
            <div className="mt-6">{children}</div>
          </Card>
          {footer ? <div className="mt-6 text-center text-sm text-ink-600">{footer}</div> : null}
        </div>
        <figure className="sticky top-24 hidden lg:block">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
            <Image src={handoverPhoto} alt="Übergabe einer Tischlampe vor einem Wiener Hauseingang" fill sizes="30rem" placeholder="blur" className="object-cover" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 text-white">
              <p className="font-display text-xl font-bold">Gutes findet man um die Ecke.</p>
              <p className="mt-1 text-sm text-white/85">Kaufen und verkaufen in deiner Nähe, in ganz Österreich.</p>
            </figcaption>
          </div>
        </figure>
      </div>
    </div>
  );
}
