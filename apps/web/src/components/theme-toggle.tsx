'use client';

import { useRef, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Swap, buttonClasses, cn } from '@marktat/ui';
import { EASE_OUT, prefersReducedMotion } from '@/lib/motion';

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

/**
 * Umschalter Hell/Dunkel; die Wahl bleibt im Browser gespeichert. Im Kopf nur als Symbol,
 * mit `withLabel` (Fuß am Handy) mit sichtbarer Beschriftung.
 */
export function ThemeToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  // Auf dem Server unbekannt: zuerst „hell“ annehmen, nach dem Laden stimmt das Symbol
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  const dark = theme === 'dark';
  const button = useRef<HTMLButtonElement>(null);

  function toggle() {
    const next: Theme = dark ? 'light' : 'dark';
    const root = document.documentElement;
    const apply = () => {
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
    };
    const rect = button.current?.getBoundingClientRect();
    if (!rect || typeof document.startViewTransition !== 'function' || prefersReducedMotion()) return apply();

    // Die neue Ansicht wird kreisförmig vom Umschalter aus aufgedeckt, statt schlagartig umzuspringen
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.setAttribute('data-theme-switch', '');
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 420, easing: EASE_OUT, pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => undefined);
    void transition.finished.finally(() => root.removeAttribute('data-theme-switch')).catch(() => undefined);
  }

  return (
    <button
      ref={button}
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={withLabel ? undefined : 'Dunkelmodus'}
      title={dark ? 'Hell anzeigen' : 'Dunkel anzeigen'}
      className={buttonClasses({ variant: 'ghost', size: 'sm', className: cn(withLabel ? '-ml-3' : 'w-10 px-0', className) })}
    >
      <Swap active={dark} on={<Sun className="size-5" aria-hidden="true" />} off={<Moon className="size-5" aria-hidden="true" />} />
      {withLabel ? 'Dunkelmodus' : null}
    </button>
  );
}
