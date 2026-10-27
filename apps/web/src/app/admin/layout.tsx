import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge, Container, Skeleton } from '@marktat/ui';
import { USER_ROLE_LABELS } from '@marktat/shared';
import { requireStaff } from '@/lib/auth';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata: Metadata = { title: { template: '%s – Moderation | MarktAT', default: 'Moderation | MarktAT' }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <Container className="py-8 sm:py-10">
      <Suspense fallback={<AdminHeaderSkeleton />}>
        <AdminHeader />
      </Suspense>
      <div className="mt-8">{children}</div>
    </Container>
  );
}

async function AdminHeader() {
  const { user } = await requireStaff('/admin');
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-ink-950 sm:text-4xl">Moderation</h1>
        <Badge tone="accent">{USER_ROLE_LABELS[user.role]}</Badge>
      </div>
      <AdminNav isAdmin={user.role === 'ADMIN'} />
    </>
  );
}

function AdminHeaderSkeleton() {
  return (
    <>
      <Skeleton className="h-10 w-56" />
      <Skeleton className="mt-6 h-11" />
    </>
  );
}
