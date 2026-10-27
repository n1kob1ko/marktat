import { Container } from '@marktat/ui';
import { AccountNav } from '@/components/account-nav';

export default function AccountLayout({ children }: LayoutProps<'/konto'>) {
  return (
    <Container className="py-8 sm:py-10">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Mein Konto</h1>
      <AccountNav />
      <div className="mt-8">{children}</div>
    </Container>
  );
}
