'use client';

import { useEffect, useRef } from 'react';
import { newClientId } from '@/lib/client-id';

/**
 * Verstecktes Feld mit einer Kennung je Formular. Erneutes Abschicken (Doppelklick, Verbindungsabbruch)
 * schickt dieselbe Kennung – die API legt dann keinen zweiten Eintrag an.
 * Erst im Browser erzeugt (nicht beim Server-Rendern), damit Server- und Browser-HTML übereinstimmen.
 */
export function ClientIdField({ name }: { name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.value) ref.current.value = newClientId();
  }, []);
  return <input ref={ref} type="hidden" name={name} defaultValue="" />;
}
