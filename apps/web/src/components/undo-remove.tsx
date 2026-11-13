'use client';

import { createContext, use, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ButtonProps } from '@marktat/ui';
import { showToast, undoable } from '@/lib/toast';

/** Ergebnis einer Server Action, die nicht weiterleitet */
export type QuietResult = { ok: true } | { ok: false; message: string };

const ItemContext = createContext<{ setRemoved: (removed: boolean) => void } | null>(null);

/**
 * Listeneintrag, der sich sofort ausblenden lässt, bevor der Server etwas gelöscht hat (siehe UndoRemoveButton).
 * Der Inhalt bleibt im Baum, damit „Rückgängig“ ihn unverändert zurückholt.
 */
export function UndoableItem({ children, className }: { children: ReactNode; className?: string }) {
  const [removed, setRemoved] = useState(false);
  return (
    <ItemContext value={{ setRemoved }}>
      <li hidden={removed} className={removed ? undefined : className} data-removed={removed || undefined}>
        {children}
      </li>
    </ItemContext>
  );
}

/**
 * „Entfernen“ ohne Sicherheitsabfrage: Der Eintrag verschwindet sofort, ein Hinweis bietet „Rückgängig“ an.
 * Erst wenn der Hinweis abläuft, ruft der Knopf `action` auf. Schlägt das fehl, kommt der Eintrag zurück.
 * Ohne JavaScript schickt der Knopf das umgebende Formular ab (dessen Action löscht und leitet weiter).
 */
export function UndoRemoveButton({
  action,
  message,
  children,
  ...props
}: Omit<ButtonProps, 'type' | 'onClick'> & {
  /** Server Action mit gebundenen Argumenten, z. B. `deleteSavedSearchQuietly.bind(null, id)` */
  action: () => Promise<QuietResult>;
  /** Text des Hinweises, z. B. „Suche gelöscht.“ */
  message: string;
}) {
  const item = use(ItemContext);
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (!item) return;
    event.preventDefault();
    item.setRemoved(true);
    undoable({
      message,
      undo: () => item.setRemoved(false),
      commit: () => {
        action()
          .catch((): QuietResult => ({ ok: false, message: 'Das hat nicht geklappt. Bitte versuche es erneut.' }))
          .then((result) => {
            if (result.ok) return router.refresh();
            item.setRemoved(false);
            showToast({ message: result.message, tone: 'danger' });
          });
      },
    });
  }

  return (
    <Button type="submit" onClick={onClick} {...props}>
      {children}
    </Button>
  );
}
