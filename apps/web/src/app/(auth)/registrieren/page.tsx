import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Registrieren', robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthShell
      title="Konto erstellen"
      intro="Kostenlos registrieren und in wenigen Minuten deine erste Anzeige aufgeben."
      footer={
        <>
          Schon registriert?{' '}
          <Link href="/anmelden" className="font-semibold text-brand-700 hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
