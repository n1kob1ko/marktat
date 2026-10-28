'use client';

import { useActionState, useState } from 'react';
import { Alert, Checkbox, Field, Input, Label, Select, Textarea } from '@marktat/ui';
import {
  SERVICE_AVAILABILITIES,
  SERVICE_AVAILABILITY_LABELS,
  SERVICE_CATEGORY_GROUPS,
  SERVICE_MAX_CATEGORIES,
  SERVICE_MAX_SKILLS,
  SERVICE_PRICE_TYPES,
  SERVICE_PRICE_TYPE_LABELS,
  type PortfolioItemView,
  type ServiceProfileDetail,
  type ServiceProfileStatus,
} from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { LocationInput } from '@/components/search/location-input';
import { SubmitButton } from '@/components/submit-button';
import {
  addQualificationAction,
  deletePortfolioItemAction,
  deleteQualificationAction,
  savePortfolioItemAction,
  saveServiceProfileAction,
  serviceProfileOpAction,
} from './actions';

const centsToInput = (cents: number | null | undefined) => (cents ? (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) : '');

/** Anbieterprofil anlegen und bearbeiten – Teil des bestehenden Kontos, keine eigene Registrierung. */
export function ServiceProfileForm({ profile }: { profile: ServiceProfileDetail | null }) {
  const [state, action] = useActionState(saveServiceProfileAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  const [priceType, setPriceType] = useState(v?.priceType ?? profile?.priceType ?? 'HOURLY');
  const [hasLocation, setHasLocation] = useState(Boolean(profile?.location));
  const selected = new Set(v ? v.categorySlugs.split(',').filter(Boolean) : (profile?.categories.map((c) => c.slug) ?? []));
  const checked = (key: 'austriaWide' | 'remote') => (v ? v[key] === 'on' : Boolean(profile?.[key]));

  return (
    <form action={action} className="space-y-8" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <Section title="Dein Angebot">
        <Field label="Überschrift" hint="z. B. „Webentwicklung mit Next.js für kleine Betriebe“" error={errors.headline} required>
          <Input name="headline" maxLength={120} defaultValue={v?.headline ?? profile?.headline} />
        </Field>
        <Field label="Kurzbeschreibung" hint="Erscheint in den Suchergebnissen (20–300 Zeichen)" error={errors.summary} required>
          <Textarea name="summary" rows={2} maxLength={300} defaultValue={v?.summary ?? profile?.summary} />
        </Field>
        <Field
          label="Ausführliche Beschreibung"
          hint="Was du anbietest, wie du arbeitest, für wen. Bitte keine Telefonnummern oder E-Mail-Adressen – Anfragen kommen über die Nachrichten."
          error={errors.description}
          required
        >
          <Textarea name="description" rows={8} maxLength={5000} defaultValue={v?.description ?? profile?.description} />
        </Field>
      </Section>

      <Section title="Kategorien">
        <fieldset aria-describedby="categories-hint" className="space-y-4">
          <legend className="sr-only">Kategorien</legend>
          <p id="categories-hint" className="text-sm text-ink-600">
            Wähle 1 bis {SERVICE_MAX_CATEGORIES} Kategorien. Bei Kategorien mit ⚖ kann in Österreich eine Gewerbeberechtigung nötig sein.
          </p>
          {errors.categorySlugs ? <p className="text-sm font-medium text-danger-600">{errors.categorySlugs[0]}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <div key={group.slug} className="space-y-2">
                <p className="text-sm font-semibold text-ink-900">{group.name}</p>
                {group.categories.map((c) => (
                  <Checkbox
                    key={c.slug}
                    name="categorySlugs"
                    value={c.slug}
                    defaultChecked={selected.has(c.slug)}
                    label={
                      <span>
                        {c.name}
                        {c.regulated ? <span title="Berufsberechtigung kann nötig sein"> ⚖</span> : null}
                      </span>
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <Field label="Fähigkeiten" hint={`Mit Komma getrennt, höchstens ${SERVICE_MAX_SKILLS}, z. B. „TypeScript, SEO, Barrierefreiheit“`} error={errors.skills}>
          <Input name="skills" maxLength={900} defaultValue={v?.skills ?? profile?.skills.join(', ')} />
        </Field>
        <Field label="Berufserfahrung in Jahren" hint="optional" error={errors.experienceYears}>
          <Input name="experienceYears" type="number" min={0} max={60} inputMode="numeric" defaultValue={v?.experienceYears ?? profile?.experienceYears ?? ''} className="max-w-32" />
        </Field>
      </Section>

      <Section title="Wo du arbeitest">
        <div className="space-y-1.5">
          <Label htmlFor="f-ort">PLZ und Ort</Label>
          <LocationInput initial={profile?.location ?? null} onChange={(has) => setHasLocation(has)} />
          {errors.locationId ? <p className="text-sm font-medium text-danger-600">{errors.locationId[0]}</p> : null}
        </div>
        {hasLocation ? (
          <Field label="Einsatzgebiet in km rund um deinen Ort" hint="optional – du erscheinst dann auch in Suchen, deren Umkreis kleiner ist" error={errors.serviceRadiusKm}>
            <Input name="serviceRadiusKm" type="number" min={1} max={500} inputMode="numeric" defaultValue={v?.serviceRadiusKm ?? profile?.serviceRadiusKm ?? ''} className="max-w-32" />
          </Field>
        ) : null}
        <Checkbox name="austriaWide" defaultChecked={checked('austriaWide')} label="Ich arbeite in ganz Österreich" />
        <Checkbox name="remote" defaultChecked={checked('remote')} label="Ich arbeite auch remote (online)" />
      </Section>

      <Section title="Preis und Verfügbarkeit">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preisangabe" error={errors.priceType} required>
            <Select name="priceType" value={priceType} onChange={(e) => setPriceType(e.target.value as typeof priceType)}>
              {SERVICE_PRICE_TYPES.map((p) => (
                <option key={p} value={p}>{SERVICE_PRICE_TYPE_LABELS[p]}</option>
              ))}
            </Select>
          </Field>
          {priceType !== 'ON_REQUEST' ? (
            <Field label={priceType === 'HOURLY' ? 'Betrag pro Stunde in €' : 'Betrag ab in €'} hint="Bruttopreis, z. B. 65" error={errors.price} required>
              <Input name="price" inputMode="decimal" maxLength={12} defaultValue={v?.price ?? centsToInput(profile?.priceCents)} />
            </Field>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Verfügbarkeit" error={errors.availability}>
            <Select name="availability" defaultValue={v?.availability ?? profile?.availability ?? 'AVAILABLE'}>
              {SERVICE_AVAILABILITIES.map((a) => (
                <option key={a} value={a}>{SERVICE_AVAILABILITY_LABELS[a]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Hinweis zur Verfügbarkeit" hint="optional, z. B. „ab März wieder frei“" error={errors.availabilityNote}>
            <Input name="availabilityNote" maxLength={160} defaultValue={v?.availabilityNote ?? profile?.availabilityNote ?? ''} />
          </Field>
        </div>
        <Field label="Website" hint="optional, mit https://" error={errors.website}>
          <Input name="website" type="url" maxLength={300} defaultValue={v?.website ?? profile?.website ?? ''} />
        </Field>
      </Section>

      <SubmitButton>{profile ? 'Änderungen speichern' : 'Profil als Entwurf speichern'}</SubmitButton>
    </form>
  );
}

/** Welche Statuswechsel im jeweiligen Status möglich sind (die API prüft dasselbe) */
function opsFor(status: ServiceProfileStatus) {
  switch (status) {
    case 'ACTIVE':
      return ['pause'] as const;
    case 'PAUSED':
      return ['resume'] as const;
    case 'REJECTED':
      return ['resubmit'] as const;
    default:
      return [] as const;
  }
}

const OP_LABELS = { pause: 'Pausieren', resume: 'Wieder sichtbar schalten', resubmit: 'Erneut prüfen lassen' } as const;

export function ServiceProfileStatusActions({ status }: { status: ServiceProfileStatus }) {
  const [state, action] = useActionState(serviceProfileOpAction, initialFormState);
  const ops = opsFor(status);
  return (
    <div className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {status === 'DRAFT' ? (
        <form action={action} className="space-y-3">
          <Checkbox
            name="confirmed"
            label="Ich bestätige, dass die Angaben stimmen und ich die Leistungen selbst anbiete. Ich gebe keine erfundenen Bewertungen, Auszeichnungen oder Qualifikationen an und habe die nötigen Berechtigungen."
          />
          <SubmitButton name="op" value="publish" size="sm">
            Veröffentlichen
          </SubmitButton>
        </form>
      ) : ops.length ? (
        <form action={action} className="flex flex-wrap gap-2">
          {ops.map((op) => (
            <SubmitButton key={op} name="op" value={op} size="sm" variant="outline">
              {OP_LABELS[op]}
            </SubmitButton>
          ))}
        </form>
      ) : null}
    </div>
  );
}

/** Profil löschen: entfernt Portfolio, Qualifikationen und Bilder. Das Konto bleibt bestehen. */
export function DeleteServiceProfileForm() {
  const [state, action] = useActionState(serviceProfileOpAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Checkbox name="confirmed" label="Ja, ich möchte mein Anbieterprofil mit Portfolio und Qualifikationen löschen." />
      <SubmitButton name="op" value="delete" size="sm" variant="ghost" className="text-danger-600">
        Profil löschen
      </SubmitButton>
    </form>
  );
}

/** Portfolio-Eintrag anlegen oder bearbeiten (Bild danach separat, mit Angabe der Bildrechte) */
export function PortfolioItemForm({ item, categories }: { item?: PortfolioItemView; categories: { slug: string; name: string }[] }) {
  const [state, action] = useActionState(savePortfolioItemAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <Field label="Titel" hint="z. B. „Website für eine Tischlerei“" error={errors.title} required>
        <Input name="title" maxLength={120} defaultValue={v?.title ?? item?.title} />
      </Field>
      <Field label="Beschreibung" hint="optional: Aufgabe, deine Rolle, Ergebnis" error={errors.description}>
        <Textarea name="description" rows={3} maxLength={1000} defaultValue={v?.description ?? item?.description ?? ''} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kategorie" hint="optional" error={errors.categorySlug}>
          <Select name="categorySlug" defaultValue={v?.categorySlug ?? item?.category?.slug ?? ''}>
            <option value="">Keine</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Link zur Arbeitsprobe" hint="optional, mit https://" error={errors.url}>
          <Input name="url" type="url" maxLength={300} defaultValue={v?.url ?? item?.url ?? ''} />
        </Field>
      </div>
      <SubmitButton size="sm" variant={item ? 'outline' : 'primary'}>{item ? 'Eintrag speichern' : 'Eintrag hinzufügen'}</SubmitButton>
    </form>
  );
}

export function DeletePortfolioItemButton({ id }: { id: string }) {
  const [state, action] = useActionState(deletePortfolioItemAction, initialFormState);
  return (
    <form action={action}>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost" className="text-danger-600">Eintrag löschen</SubmitButton>
    </form>
  );
}

/** Qualifikation angeben – öffentlich als „Angabe der Anbieter:in“, bis das Team sie geprüft hat */
export function QualificationForm() {
  const [state, action] = useActionState(addQualificationAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Field label="Qualifikation" hint="z. B. „Meisterprüfung Elektrotechnik“ oder „Gewerbeberechtigung Werbegrafik“" error={errors.title} required>
        <Input name="title" maxLength={120} defaultValue={v?.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ausgestellt von" hint="optional, z. B. Wirtschaftskammer, Behörde" error={errors.issuer}>
          <Input name="issuer" maxLength={120} defaultValue={v?.issuer} />
        </Field>
        <Field label="Nummer bzw. Referenz" hint="optional, z. B. GISA-Zahl – öffentlich erst nach der Prüfung" error={errors.reference}>
          <Input name="reference" maxLength={120} defaultValue={v?.reference} />
        </Field>
      </div>
      <SubmitButton size="sm" variant="outline">Qualifikation hinzufügen</SubmitButton>
    </form>
  );
}

export function DeleteQualificationButton({ id }: { id: string }) {
  const [state, action] = useActionState(deleteQualificationAction, initialFormState);
  return (
    <form action={action}>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost" className="text-danger-600">Entfernen</SubmitButton>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="font-sans text-lg font-semibold tracking-normal text-ink-950">{title}</h3>
      {children}
    </section>
  );
}
