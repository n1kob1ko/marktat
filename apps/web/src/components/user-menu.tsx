import Link from 'next/link';
import { CircleUserRound } from 'lucide-react';
import { buttonClasses } from '@marktat/ui';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/app/(auth)/actions';

/** Liest die Sitzung – steht deshalb im Header hinter einer Suspense-Grenze. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href="/anmelden" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
        Anmelden
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Link href="/konto" className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'max-w-44' })}>
        <CircleUserRound className="size-5 shrink-0" aria-hidden="true" />
        <span className="hidden truncate lg:inline">{user.displayName}</span>
        <span className="lg:hidden">Konto</span>
      </Link>
      <form action={logoutAction} className="hidden sm:block">
        <button type="submit" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          Abmelden
        </button>
      </form>
    </div>
  );
}
