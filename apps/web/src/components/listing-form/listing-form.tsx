'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { Eye, Lightbulb, MapPin } from 'lucide-react';
import { Alert, Button, Card, cn, Field, Input, Select, Textarea } from '@marktat/ui';
import {
  categoryAttributeSchema,
  ITEM_CONDITION_LABELS,
  ITEM_CONDITIONS,
  isAustrianPostalCode,
  formatPriceCents,
  formatSalary,
  listingFacts,
  parseEuroInputToCents,
  priceFieldLabel,
  priceSuffix,
  readAttributeForm,
  PRICE_TYPE_LABELS,
  PRICE_TYPES,
  VERTICAL_LABELS,
  type AutofillSuggestion,
  type CategoryNode,
  type ListingDetail,
  type LocationSummary,
  type PriceHint,
  type PriceType,
  type Vertical,
} from '@marktat/shared';
import { PriceTag } from '@/components/price-tag';
import { ClientIdField } from '@/components/client-id-field';
import { initialFormState, type FormState } from '@/lib/form-state';
import { clearPendingPhotos, savePendingPhotos } from '@/lib/pending-photo';
import { AttributeFields, attributesToInput, type AttributeInputValues } from './attribute-fields';
import { PhotoPicker, type PickedPhoto } from './photo-picker';
import { ChoiceChips } from './choice-chips';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ListingFormProps {
  categories: CategoryNode[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  listing?: ListingDetail;
  /** Laufzeit und ob das Veröffentlichen gerade kostenlos ist (aus den Preisen im Admin-Bereich) */
  terms?: { days: number; free: boolean };
  /** „Mit KI ausfüllen“ anbieten (nur beim Anlegen und wenn der Foto-Assistent in der API eingeschaltet ist) */
  photoAssistant?: boolean;
}

const CONDITION_OPTIONS = [{ value: '', label: 'Keine Angabe' }, ...ITEM_CONDITIONS.map((c) => ({ value: c as string, label: ITEM_CONDITION_LABELS[c] }))];
const PRICE_TYPE_OPTIONS = PRICE_TYPES.map((type) => ({
  value: type,
  label: PRICE_TYPE_LABELS[type],
}));

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

export function ListingForm({ categories, action, listing, terms = { days: 60, free: true }, photoAssistant = false }: ListingFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialFormState);
  const [, startTransition] = useTransition();
  const [intent, setIntent] = useState<'draft' | 'publish'>('publish');

  // Bewusst onSubmit statt action-Prop: React setzt Formulare nach einer Action sonst zurück,
  // was bei kontrollierten Auswahllisten die sichtbare Auswahl verliert.
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    setIntent(formData.get('intent') === 'draft' ? 'draft' : 'publish');
    // Fotos für den Bilder-Schritt nach dem Anlegen merken, bevor die Anfrage dorthin weiterleitet
    if (!listing) await savePendingPhotos(photos.map((p) => p.blob));
    startTransition(() => formAction(formData));
  };
  const v = state.values;
  // Kategorie Ebene für Ebene (Hauptkategorie → Unterkategorie → genauere Kategorie); gespeichert wird nur die unterste
  const nodes = useMemo(() => {
    const byId = new Map<string, { node: CategoryNode; parentId: string | null }>();
    const walk = (list: CategoryNode[], parentId: string | null) => {
      for (const node of list) {
        byId.set(node.id, { node, parentId });
        walk(node.children, node.id);
      }
    };
    walk(categories, null);
    return byId;
  }, [categories]);

  const initialCategory = v?.categoryId ?? listing?.category.id ?? '';
  const [selection, setSelection] = useState<string[]>(() => {
    const chain: string[] = [];
    for (let id: string | null = initialCategory || null; id && nodes.has(id); id = nodes.get(id)!.parentId) chain.unshift(id);
    return chain;
  });
  const selectedNodes = useMemo(() => selection.map((id) => nodes.get(id)?.node).filter((n): n is CategoryNode => Boolean(n)), [selection, nodes]);
  const deepest = selectedNodes.at(-1);
  const categoryId = deepest && deepest.children.length === 0 ? deepest.id : '';
  const choose = (level: number, id: string) => setSelection((current) => [...current.slice(0, level), ...(id ? [id] : [])]);
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
  const [lookupResult, setLookupResult] = useState<{
    postalCode: string;
    status: 'idle' | 'empty' | 'error';
  }>({
    postalCode: listing?.location?.postalCode ?? '',
    status: 'idle',
  });

  // Fotos aus dem Formular (werden nach dem Anlegen hochgeladen); die Vorschau zeigt das Titelbild
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const previewPhoto = photos[0]?.url ?? null;
  // Foto-Assistent: Vorschläge übernehmen, vorherigen Stand für „Rückgängig“ merken
  const beforeSuggestion = useRef<{
    selection: string[];
    title: string;
    description: string;
    attributes: AttributeInputValues;
  } | null>(null);
  useEffect(() => {
    // Alte, nicht verwendete Fotos eines früheren Versuchs sollen nicht in diesem Inserat landen
    if (!listing) void clearPendingPhotos();
  }, [listing]);
  const applySuggestion = (suggestion: AutofillSuggestion): string[] => {
    beforeSuggestion.current = {
      selection,
      title,
      description,
      attributes: attributeValues,
    };
    const filled: string[] = [];
    if (suggestion.categoryId && nodes.has(suggestion.categoryId)) {
      const chain: string[] = [];
      for (let id: string | null = suggestion.categoryId; id && nodes.has(id); id = nodes.get(id)!.parentId) chain.unshift(id);
      setSelection(chain);
      filled.push('Kategorie');
    }
    if (suggestion.title) {
      setTitle(suggestion.title);
      filled.push('Titel');
    }
    if (suggestion.description) {
      setDescription(suggestion.description);
      filled.push('Beschreibung');
    }
    const keys = Object.keys(suggestion.attributes);
    if (keys.length) {
      setAttributeValues((current) => ({
        ...current,
        ...attributesToInput(suggestion.attributes),
      }));
      const fields = categoryAttributeSchema(suggestion.categoryPath).fields;
      filled.push(...fields.filter((f) => keys.includes(f.key) && !(f.kind === 'select' && f.fixed)).map((f) => f.label));
    }
    return filled;
  };
  const undoSuggestion = () => {
    const before = beforeSuggestion.current;
    if (!before) return;
    setSelection(before.selection);
    setTitle(before.title);
    setDescription(before.description);
    setAttributeValues(before.attributes);
    beforeSuggestion.current = null;
  };

  const deepestPath = deepest?.path;
  const schema = useMemo(() => categoryAttributeSchema(deepestPath), [deepestPath]);
  const attributeForm = useMemo(
    () => readAttributeForm(schema, (name) => [attributeValues[name.slice('attr.'.length)] ?? []].flat()),
    [schema, attributeValues],
  );
  const typedAttributes = attributeForm.attributes;
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

  // Preisvorschlag aus ähnlichen Inseraten (mit dem gewählten Ort genauer)
  const hintKey = categoryId && hasPrice ? `${categoryId}:${locationId}` : '';
  const [priceHint, setPriceHint] = useState<{ key: string; hint: PriceHint | null } | null>(null);
  useEffect(() => {
    if (!hintKey) return;
    const [category, place] = hintKey.split(':');
    const params = new URLSearchParams({ kategorie: category });
    if (place) params.set('ort', place);
    const controller = new AbortController();
    fetch(`${API_URL}/v1/listings/price-hint?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<PriceHint>) : null))
      .then((hint) => setPriceHint({ key: hintKey, hint }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setPriceHint({ key: hintKey, hint: null });
      });
    return () => controller.abort();
  }, [hintKey]);
  const hint = hintKey && priceHint?.key === hintKey ? priceHint.hint : null;

  const lookup = isAustrianPostalCode(postalCode) && lookupResult.postalCode !== postalCode ? 'loading' : lookupResult.status;
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

        <div className="space-y-6">
          {!listing ? <PhotoPicker ai={photoAssistant} onPhotosChange={setPhotos} onSuggestion={applySuggestion} onUndo={undoSuggestion} /> : null}

          <Card className="space-y-5 p-5 sm:p-7">
            <h2 className="font-sans text-lg font-semibold tracking-normal">Was bietest du an?</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Bereich & Kategorie" error={!selection.length ? errors.categoryId : undefined} required>
                <Select value={selection[0] ?? ''} onChange={(e) => choose(0, e.target.value)}>
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
              {selectedNodes.map((parent, i) =>
                parent.children.length > 0 ? (
                  <Field
                    key={parent.id}
                    label={i === 0 ? 'Unterkategorie' : 'Genauere Kategorie'}
                    error={selection.length === i + 1 ? errors.categoryId : undefined}
                    required
                  >
                    <Select value={selection[i + 1] ?? ''} onChange={(e) => choose(i + 1, e.target.value)}>
                      <option value="">Bitte wählen …</option>
                      {parent.children.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null,
              )}
              <input type="hidden" name="categoryId" value={categoryId} />
            </div>

            <Field label="Titel" hint={`${title.length}/90 Zeichen – kurz und konkret, z. B. „Kinderfahrrad 20 Zoll, blau“.`} error={errors.title} required>
              <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} />
            </Field>

            <Field
              label="Beschreibung"
              hint={`${DESCRIPTION_HINTS[selectedNodes[0]?.vertical ?? 'MARKETPLACE']} Mindestens 20 Zeichen.`}
              error={errors.description}
              required
            >
              <Textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={7} />
            </Field>

            {schema.itemCondition ? (
              <ChoiceChips
                name="condition"
                legend="Zustand"
                options={CONDITION_OPTIONS}
                value={condition}
                onChange={setCondition}
                error={errors.condition}
                columns="grid-cols-2 sm:grid-cols-3"
              />
            ) : null}
            <AttributeFields
              schema={schema}
              values={attributeValues}
              onChange={(key, value) => setAttributeValues((current) => ({ ...current, [key]: value }))}
              errors={errors}
            />
          </Card>
        </div>

        <div className="space-y-6">
          {hasPrice ? (
            <Card className="space-y-5 p-5 sm:p-7">
              <h2 className="font-sans text-lg font-semibold tracking-normal">Preis</h2>
              <ChoiceChips name="priceType" legend="Preisart" legendHidden options={PRICE_TYPE_OPTIONS} value={priceType} onChange={setPriceType} />
              {needsPrice ? (
                <Field label={priceFieldLabel(schema, typedAttributes)} hint="z. B. 49 oder 1.299,90" error={errors.price ?? errors.priceCents} required>
                  <Input name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="max-w-48" />
                </Field>
              ) : null}
              <div aria-live="polite">{needsPrice && hint ? <PriceHintNote hint={hint} onUse={(cents) => setPrice(centsToInput(cents))} /> : null}</div>
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
                hint={
                  lookup === 'loading'
                    ? 'Orte werden gesucht …'
                    : lookup === 'empty'
                      ? 'Zu dieser PLZ ist noch kein Ort hinterlegt.'
                      : lookup === 'error'
                        ? 'Orte konnten nicht geladen werden.'
                        : undefined
                }
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
        </div>

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
          {previewPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- lokales Foto (blob:), noch nicht hochgeladen
            <img src={previewPhoto} alt="" className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="aspect-[4/3] bg-canvas" />
          )}
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

/** Preisspanne ähnlicher Inserate mit Knopf zum Übernehmen der Mitte */
function PriceHintNote({ hint, onUse }: { hint: PriceHint; onUse: (cents: number) => void }) {
  const where = hint.scope === 'nearby' ? `im Umkreis von ${hint.radiusKm} km` : 'in ganz Österreich';
  if (hint.medianCents === null || hint.lowCents === null || hint.highCents === null) {
    return (
      <p className="flex gap-2.5 rounded-xl bg-canvas p-3.5 text-sm text-ink-600">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden="true" />
        Für einen Preisvorschlag gibt es in dieser Kategorie noch zu wenige Inserate.
      </p>
    );
  }
  const median = hint.medianCents;
  const range =
    hint.lowCents === hint.highCents ? formatPriceCents(hint.lowCents) : `${formatPriceCents(hint.lowCents)} bis ${formatPriceCents(hint.highCents)}`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent-100 bg-accent-50 p-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="flex gap-2.5 text-ink-800">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-700" aria-hidden="true" />
        <span>
          <span className="font-semibold">Preisvorschlag:</span> Ähnliche Inserate {where} kosten meist <strong>{range}</strong> (Mitte{' '}
          {formatPriceCents(median)}, {hint.count} Inserate).
        </span>
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => onUse(median)} className="shrink-0">
        {formatPriceCents(median)} übernehmen
      </Button>
    </div>
  );
}
