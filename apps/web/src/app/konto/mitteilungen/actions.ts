'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export async function markNotificationsReadAction() {
  const { token } = await requireUser('/konto/mitteilungen', { allowSuspended: true });
  await api('/me/notifications/read', { method: 'POST', token, body: {} });
  revalidatePath('/konto/mitteilungen');
}
