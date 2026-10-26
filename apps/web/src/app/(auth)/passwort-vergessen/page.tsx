import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { ForgotPasswordForm } from './forgot-form';

export const metadata: Metadata = { title: 'Passwort vergessen', robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Passwort vergessen?"
      intro="Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst."
      footer={
        <Link href="/anmelden" className="font-semibold text-brand-700 hover:underline">
          Zurück zur Anmeldung
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
