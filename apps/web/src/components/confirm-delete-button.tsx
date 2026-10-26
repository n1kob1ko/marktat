'use client';

import { useState } from 'react';
import { buttonClasses } from '@marktat/ui';

/** Zweistufiges Löschen ohne Browser-Dialog: erst nachfragen, dann absenden. */
export function ConfirmDeleteButton() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'text-danger-600 hover:bg-danger-50 hover:text-danger-700' })}
      >
        Löschen
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2" role="group" aria-label="Löschen bestätigen">
      <button type="submit" name="action" value="delete" className={buttonClasses({ variant: 'danger', size: 'sm' })} autoFocus>
        Endgültig löschen
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
        Abbrechen
      </button>
    </span>
  );
}
