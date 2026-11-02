import { Suspense } from 'react';
import { Container } from '@marktat/ui';
import { AccountNav, AccountNavFallback } from '@/components/account-nav';
import { getCurrentUser, isStaff } from '@/lib/auth';

export default function AccountLayout({ children }: LayoutProps<'/konto'>) {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Mein Konto</h1>
      <div className="mt-6 lg:mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <Suspense fallback={<AccountNavFallback />}>
          <AccountNavForUser />
        </Suspense>
        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </Container>
  );
}

async function AccountNavForUser() {
  const user = await getCurrentUser();
  return <AccountNav showSecurity={isStaff(user)} showDeals={user?.accountType === 'BUSINESS'} />;
}
