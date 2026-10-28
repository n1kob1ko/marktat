import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Card, Skeleton } from '@marktat/ui';
import { PROJECT_MAX_CONTACTS, PROJECT_RUN_DAYS } from '@marktat/shared';
import { requireUser } from '@/lib/auth';
import { ProjectForm } from '../forms';

export const metadata: Metadata = { title: 'Projektauftrag beschreiben', robots: { index: false } };

export default function NewProjectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem]" />}>
      <NewProject />
    </Suspense>
  );
}

async function NewProject() {
  await requireUser('/konto/projekte/neu');
  return (
    <div className="space-y-6">
      <nav aria-label="Brotkrümel" className="text-sm text-ink-500">
        <Link href="/konto/projekte" className="hover:text-brand-700 hover:underline">Projektaufträge</Link>
      </nav>
      <Card className="space-y-2 p-5 sm:p-7">
        <h2 className="font-sans text-xl font-semibold tracking-normal">Projektauftrag beschreiben</h2>
        <p className="text-sm text-ink-700">
          Für einmalige Vorhaben, die jemand selbstständig für dich erledigt. Du suchst eine Mitarbeiterin oder einen Mitarbeiter mit fixen Arbeitszeiten? Das ist ein
          Stellenangebot und gehört als Inserat unter <Link href="/inserieren" className="font-semibold text-brand-700 hover:underline">Jobs</Link>.
        </p>
        <p className="text-sm text-ink-700">
          Nach dem Speichern prüfst du den Entwurf und veröffentlichst ihn für {PROJECT_RUN_DAYS} Tage. Antworten können höchstens {PROJECT_MAX_CONTACTS} Anbieter:innen mit
          sichtbarem Anbieterprofil.
        </p>
      </Card>
      <Card className="p-5 sm:p-7">
        <ProjectForm project={null} />
      </Card>
    </div>
  );
}
