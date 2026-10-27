'use client';

import { useActionState, useEffect, useMemo, useState, useTransition, type FormEvent } from 'react';
import { Eye, MapPin } from 'lucide-react';
import { Alert, Button, Card, cn, Field, Input, Select, Textarea } from '@marktat/ui';
import {
  categoryAttributeSchema,
  ITEM_CONDITION_LABELS,
  ITEM_CONDITIONS,
  isAustrianPostalCode,
  formatSalary,
  listingFacts,
  parseEuroInputToCents,
  priceFieldLabel,
  priceSuffix,
  readAttributeForm,
  PRICE_TYPE_LABELS,
  PRICE_TYPES,
  VERTICAL_LABELS,
  type CategoryNode,
  type ListingDetail,
  type LocationSummary,
  type PriceType,
  type Vertical,
} from '@marktat/shared';
import { PriceTag } from '@/components/price-tag';
import { ClientIdField } from '@/components/client-id-field';
import { initialFormState, type FormState } from '@/lib/form-state';
import { AttributeFields, attributesToInput, type AttributeInputValues } from './attribute-fields';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ListingFormProps {
  categories: CategoryNode[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  listing?: ListingDetail;
  /** Laufzeit und ob das Veröffentlichen gerade kostenlos ist (aus den Preisen im Admin-Bereich) */
  terms?: { days: number; free: boolean };
}

const DESCRIPTION_HINTS: Record<Vertical, string> = {
  MARKETPLACE: 'Zustand, Maße, Zubehör, Abholung oder Versand.',
  VEHICLES: 'Ausstattung, Service, Pickerl, Vorschäden.',
  REAL_ESTATE: 'Lage, Raumaufteilung, Verfügbarkeit, Provision und Kaution.',
  JOBS: 'Aufgaben, Anforderungen und was du bietest.',
};

function centsToInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toLocaleString('de-AT', { minimumFractionDigits: cents % 100 ? 2 : 0 });
}

export function ListingForm({ categories, action, listing, terms = { days: 60, free: true } }: ListingFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const [, startTransition] = useTransition();
  const [intent, setIntent] = useState<'draft' | 'publish'>('publish');

  // Bewusst onSubmit statt action-Prop: React setzt Formulare nach einer Action sonst zurück,
  // was bei kontrollierten Auswahllisten die sichtbare Auswahl verliert.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    setIntent(formData.get('intent') === 'draft' ? 'draft' : 'publish');
    startTransition(() => formAction(formData));
  };
  const v = state.values;
  const parentOf = useMemo(() => {
    const map = new Map<string, CategoryNode>();
    for (const top of categories) for (const child of top.children) map.set(child.id, top);
    return map;
  }, [categories]);

  const initialCategory = v?.categoryId ?? listing?.category.id ?? '';
  const [mainId, setMainId] = useState(parentOf.get(initialCategory)?.id ?? (initialCategory || ''));
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [title, setTitle] = useState(v?.title ?? listing?.title ?? '');
  const [description, setDescription] = useState(v?.description ?? listing?.description ?? '');
  const [priceType, setPriceType] = useState<PriceType>((v?.priceType as PriceType) || listing?.priceType || 'FIXED');
  const [price, setPrice] = useState(v?.price ?? centsToInput(listing?.priceCents));
  const [postalCode, setPostalCode] = useState(v?.postalCode ?? listing?.location?.postalCode ?? '');
  const [locations, setLocations] = useState<LocationSummary[]>(listing?.location ? [listing.location] : []);
  const [locationId, setLocationId] = useState(v?.locationId ?? (listing?.location ? String(listing.location.id) : ''));
  const [condition, setCondition] = useState(v?.condition ?? listing?.condition ?? '');
  // Zusatzangaben aller bisher gewählten Kategorien; abgeschickt werden nur die der aktuellen.
  const [attributeValues, setAttributeValues] = useState<AttributeInputValues>(() => attributesToInput(listing?.attributes));
  // Für welche PLZ die Ortssuche zuletzt abgeschlossen wurde; „lädt“ wird daraus abgeleitet.
  const [lookupResult, setLookupResult] = useState<{ postalCode: string; status: 'idle' | 'empty' | 'error' }>({
    postalCode: listing?.location?.postalCode ?? '',
    status: 'idle',
  });

  const main = categories.find((c) => c.id === mainId);
  const selectedCategory = main?.children.find((c) => c.id === categoryId) ?? main;
  const schema = useMemo(() => categoryAttributeSchema(selectedCategory?.path), [selectedCategory?.path]);
  const typedAttributes = useMemo(
    () => readAttributeForm(schema, (name) => [attributeValues[name.slice('attr.'.length)] ?? []].flat()).attributes,
    [schema, attributeValues],
  );
  const hasPrice = schema.price !== 'none';
  const needsPrice = hasPrice && (priceType === 'FIXED' || priceType === 'NEGOTIABLE');

  // PLZ → Orte nachschlagen (öffentlicher Endpunkt der API)
  useEffect(() => {
    if (!isAustrianPostalCode(postalCode)) return;
    const controller = new AbortController();
    fetch(`${API_URL}/v1/geo/locations?q=${postalCode}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: LocationSummary[]) => {
        setLocations(rows);
        setLookupResult({ postalCode, status: rows.length ? 'idle' : 'empty' });
        setLocationId((current) => (rows.some((r) => String(r.id) === current) ? current : rows[0] ? String(rows[0].id) : ''));
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLookupResult({ postalCode, status: 'error' });
      });
    return () => controller.abort();
  }, [postalCode]);

  const lookup =
    isAustrianPostalCode(postalCode) && lookupResult.postalCode !== postalCode ? 'loading' : lookupResult.status;
  const selectedLocation = locations.find((l) => String(l.id) === locationId);
  const previewCents = needsPrice ? parseEuroInputToCents(price) : null;
  const previewFacts = listingFacts(schema, typedAttributes);
  const previewSalary = formatSalary(typedAttributes, true);
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[1fr_20rem]" noValidate>
      {listing ? <input type="hidden" name="id" value={listing.id} /> : <ClientIdField name="clientRequestId" />}
      <div className="space-y-6">
        {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

        <Card className="space-y-5 p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Was bietest du an?</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Bereich & Kategorie" error={!categoryId ? errors.categoryId : undefined} required>
              <Select
                value={mainId}
                onChange={(e) => {
                  setMainId(e.target.value);
                  const next = categories.find((c) => c.id === e.target.value);
                  setCategoryId(next && next.children.length === 0 ? next.id : '');
                }}
              >
                <option value="">Bitte wählen …</option>
                {(['MARKETPLACE', 'VEHICLES', 'REAL_ESTATE', 'JOBS'] as const).map((vertical) => (
                  <optgroup key={vertical} label={VERTICAL_LABELS[vertical]}>
                    {categories
                      .filter((c) => c.vertical === vertical)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            {main && main.children.length > 0 ? (
              <Field label="Unterkategorie" error={errors.categoryId} required>
                <Select name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Bitte wählen …</option>
                  {main.children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="categoryId" value={categoryId} />
            )}
          </div>

          <Field label="Titel" hint={`${title.length}/90 Zeichen – kurz und konkret, z. B. „Kinderfahrrad 20 Zoll, blau“.`} error={errors.title} required>
            <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} />
          </Field>

          <Field label="Beschreibung" hint={`${DESCRIPTION_HINTS[main?.vertical ?? 'MARKETPLACE']} Mindestens 20 Zeichen.`} error={errors.description} required>
            <Textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={7} />
          </Field>

          {schema.itemCondition ? (
            <Field label="Zustand" error={errors.condition}>
              <Select name="condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
                <option value="">Keine Angabe</option>
                {ITEM_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {ITEM_CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <AttributeFields
            schema={schema}
            values={attributeValues}
            onChange={(key, value) => setAttributeValues((current) => ({ ...current, [key]: value }))}
            errors={errors}
          />
        </Card>

        {hasPrice ? (
          <Card className="space-y-5 p-5 sm:p-7">
            <h2 className="font-sans text-lg font-semibold tracking-normal">Preis</h2>
            <fieldset>
              <legend className="sr-only">Preisart</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRICE_TYPES.map((type) => (
                  <label
                    key={type}
                    className={cn(
                      'flex cursor-pointer items-center justify-center rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition-colors has-focus-visible:ring-3 has-focus-visible:ring-brand-500/30',
                      priceType === type ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line-strong text-ink-700 hover:border-ink-400',
                    )}
                  >
                    <input type="radio" name="priceType" value={type} checked={priceType === type} onChange={() => setPriceType(type)} className="sr-only" />
                    {PRICE_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>
            {needsPrice ? (
              <Field label={priceFieldLabel(schema, typedAttributes)} hint="z. B. 49 oder 1.299,90" error={errors.price ?? errors.priceCents} required>
                <Input name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="max-w-48" />
              </Field>
            ) : null}
          </Card>
        ) : (
          // Jobs: kein Preis, das Gehalt steht in den Details
          <input type="hidden" name="priceType" value="ON_REQUEST" />
        )}

        <Card className="space-y-5 p-5 sm:p-7">
          <h2 className="font-sans text-lg font-semibold tracking-normal">{schema.locationLabel}</h2>
          <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
            <Field label="Postleitzahl" error={errors.postalCode} required>
              <Input
                name="postalCode"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label="Ort"
              hint={lookup === 'loading' ? 'Orte werden gesucht …' : lookup === 'empty' ? 'Zu dieser PLZ ist noch kein Ort hinterlegt.' : lookup === 'error' ? 'Orte konnten nicht geladen werden.' : undefined}
              error={errors.locationId}
              required
            >
              <Select name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!locations.length}>
                {!locations.length ? <option value="">Zuerst PLZ eingeben</option> : null}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.place} ({l.district}, {l.state})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-ink-500">Angezeigt werden nur PLZ und Ort – nie deine Adresse.</p>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="submit" name="intent" value="draft" variant="outline" size="lg" loading={isPending && intent === 'draft'} disabled={isPending}>
            Als Entwurf speichern
          </Button>
          <Button type="submit" name="intent" value="publish" size="lg" loading={isPending && intent === 'publish'} disabled={isPending}>
            {listing && listing.status !== 'DRAFT' ? 'Speichern & veröffentlichen' : 'Anzeige veröffentlichen'}
          </Button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Anzeigenvorschau">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-700">
          <Eye className="size-4" aria-hidden="true" /> Vorschau
        </p>
        <Card className="overflow-hidden">
          <div className="aspect-[4/3] bg-canvas" />
          <div className="space-y-2 p-4">
            <p className={cn('line-clamp-2 font-semibold', title ? 'text-ink-900' : 'text-ink-500')}>{title || 'Dein Titel'}</p>
            {previewFacts.length ? <p className="text-sm text-ink-600">{previewFacts.join(' · ')}</p> : null}
            <PriceTag
              priceType={hasPrice ? priceType : 'ON_REQUEST'}
              priceCents={previewCents}
              suffix={priceSuffix(schema, typedAttributes)}
              salary={hasPrice ? undefined : previewSalary}
              className="text-lg"
            />
            <p className="flex items-center gap-1 text-xs text-ink-500">
              <MapPin className="size-3.5" aria-hidden="true" />
              {selectedLocation ? `${selectedLocation.postalCode} ${selectedLocation.place}` : 'PLZ und Ort'}
            </p>
          </div>
        </Card>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          {terms.free ? 'Anzeigen sind derzeit kostenlos und' : 'Anzeigen sind'} {terms.days} Tage online. Du kannst sie jederzeit pausieren, verlängern oder
          löschen.
        </p>
      </aside>
    </form>
  );
}
