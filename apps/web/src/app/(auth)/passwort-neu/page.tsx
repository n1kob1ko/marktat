import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { ResetPasswordForm } from './reset-form';

export const metadata: Metadata = { title: 'Neues Passwort', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Neues Passwort festlegen" intro="Wähle ein sicheres Passwort, das du nirgendwo sonst verwendest.">
      <ResetPasswordForm />
    </AuthShell>
  );
}
