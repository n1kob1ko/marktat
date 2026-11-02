import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge, Container, Skeleton } from '@marktat/ui';
import { USER_ROLE_LABELS } from '@marktat/shared';
import { requireStaff } from '@/lib/auth';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata: Metadata = { title: { template: '%s – Moderation | Markterl', default: 'Moderation | Markterl' }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<Skeleton className="h-10 w-56" />}>
        <AdminTitle />
      </Suspense>
      <div className="mt-6 lg:mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <Suspense fallback={<Skeleton className="h-12 lg:h-96" />}>
          <AdminNavForUser />
        </Suspense>
        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </Container>
  );
}

async function AdminTitle() {
  const { user } = await requireStaff('/admin');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Moderation</h1>
      <Badge tone="accent">{USER_ROLE_LABELS[user.role]}</Badge>
    </div>
  );
}

async function AdminNavForUser() {
  const { user } = await requireStaff('/admin');
  return <AdminNav isAdmin={user.role === 'ADMIN'} />;
}
