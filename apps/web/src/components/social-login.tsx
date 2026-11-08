import Link from 'next/link';
import { buttonClasses, cn } from '@marktat/ui';
import { oauthAction } from '@/app/(auth)/actions';
import { enabledProviders, PROVIDER_LABELS, type SocialProvider } from '@/lib/auth-providers';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.3-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 fill-current" aria-hidden="true">
      <path d="M16.4 12.7c0-2.5 2.1-3.7 2.2-3.8-1.2-1.7-3-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.8 1.3 10.3.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.2-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.9-4.3zM13.9 5.2c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" />
    </svg>
  );
}

const ICONS: Record<SocialProvider, () => React.JSX.Element> = { google: GoogleIcon, apple: AppleIcon };

/**
 * Schaltflächen „Mit Google/Apple …“. Erscheinen nur, wenn AUTH_PROVIDERS gesetzt ist (siehe lib/auth-providers.ts).
 * `verb`: „anmelden“ auf der Anmeldeseite, „registrieren“ bei der Registrierung – technisch ist es derselbe Weg.
 */
export function SocialLogin({ next, verb = 'anmelden', className }: { next?: string; verb?: 'anmelden' | 'registrieren'; className?: string }) {
  if (!enabledProviders.length) return null;
  return (
    <div className={cn('space-y-3', className)}>
      {enabledProviders.map((provider) => {
        const Icon = ICONS[provider];
        return (
          <form key={provider} action={oauthAction}>
            <input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="weiter" value={next ?? '/konto'} />
            <button type="submit" className={cn(buttonClasses({ variant: 'outline', size: 'lg' }), 'w-full gap-3')}>
              <Icon />
              Mit {PROVIDER_LABELS[provider]} {verb}
            </button>
          </form>
        );
      })}
      {verb === 'registrieren' ? (
        <p className="text-xs leading-relaxed text-ink-500">
          Mit der Registrierung über {enabledProviders.map((p) => PROVIDER_LABELS[p]).join(' oder ')} akzeptierst du die{' '}
          <Link href="/agb" className="underline" target="_blank">
            Nutzungsbedingungen
          </Link>{' '}
          und hast die{' '}
          <Link href="/datenschutz" className="underline" target="_blank">
            Datenschutzerklärung
          </Link>{' '}
          gelesen. Dein Konto wird als privates Konto angelegt.
        </p>
      ) : null}
      <div className="flex items-center gap-3 text-xs tracking-wide text-ink-500 uppercase" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        oder mit E-Mail
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
