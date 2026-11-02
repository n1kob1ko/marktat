'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { buttonClasses, cn } from '@marktat/ui';

export const THEME_STORAGE_KEY = 'markterl-theme';

type Theme = 'light' | 'dark';

/**
 * Setzt data-theme vor dem ersten Zeichnen (im <head>), damit die Seite nicht kurz hell aufblitzt.
 * Ohne eigene Wahl gilt die Einstellung des Geräts.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`;

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Folgt der Geräteeinstellung, solange niemand selbst umgeschaltet hat
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystem = () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {}
    if (stored !== 'light' && stored !== 'dark') document.documentElement.setAttribute('data-theme', media.matches ? 'dark' : 'light');
  };
  media.addEventListener('change', onSystem);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onSystem);
  };
}

/** Umschalter Hell/Dunkel im Kopf; die Wahl bleibt im Browser gespeichert. */
export function ThemeToggle({ className }: { className?: string }) {
  // Auf dem Server unbekannt: zuerst „hell“ annehmen, nach dem Laden stimmt das Symbol
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  const dark = theme === 'dark';

  function toggle() {
    const next: Theme = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label="Dunkelmodus"
      title={dark ? 'Hell anzeigen' : 'Dunkel anzeigen'}
      className={buttonClasses({ variant: 'ghost', size: 'sm', className: cn('w-10 px-0', className) })}
    >
      {dark ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
    </button>
  );
}
