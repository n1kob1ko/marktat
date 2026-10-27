'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import type { FormState } from '@/lib/form-state';

export async function updateNotificationsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireUser('/konto/benachrichtigungen');
  try {
    await api('/me/notifications', {
      method: 'PATCH',
      token,
      body: {
        notifyMessagesByEmail: formData.get('notifyMessagesByEmail') === 'on',
        notifySearchesByEmail: formData.get('notifySearchesByEmail') === 'on',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/konto/benachrichtigungen');
  return { status: 'success', message: 'Deine Einstellungen wurden gespeichert.' };
}
