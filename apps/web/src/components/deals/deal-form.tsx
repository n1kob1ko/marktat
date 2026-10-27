'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Checkbox, Field, Input, Select, Textarea } from '@marktat/ui';
import {
  DEAL_AVAILABILITIES,
  DEAL_AVAILABILITY_LABELS,
  DEAL_CHANNELS,
  DEAL_CHANNEL_LABELS,
  DEAL_MAX_DURATION_DAYS,
  REFERENCE_PRICE_LABELS,
  toViennaDay,
  type DealCategoryView,
  type DealDetail,
  type DealStoreView,
} from '@marktat/shared';
import { initialFormState } from '@/lib/form-state';
import { saveDealAction } from '@/app/konto/deals/actions';
import { ClientIdField } from '@/components/client-id-field';
import { SubmitButton } from '@/components/submit-button';

const centsToInput = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');

/**
 * Formular für Deals (anlegen und bearbeiten). Vergleichspreise nur mit Grundlage und Bestätigung; der Rabatt
 * wird nicht eingegeben, sondern von MarktAT berechnet.
 */
export function DealForm({
  categories,
  stores,
  deal,
  externalId,
  canPublish,
}: {
  categories: DealCategoryView[];
  stores: DealStoreView[];
  deal?: DealDetail;
  externalId?: string | null;
  canPublish: boolean;
}) {
  const [state, action] = useActionState(saveDealAction, initialFormState);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  const [channel, setChannel] = useState(v?.channel ?? deal?.channel ?? 'ONLINE');
  const [referenceType, setReferenceType] = useState(v?.referenceType ?? (deal?.discountPercent !== null ? (deal?.referencePriceType ?? '') : ''));
  const selectedStores = new Set(deal?.stores.map((s) => s.id) ?? []);
  const today = toViennaDay(new Date());
  const isDraft = !deal || deal.status === 'DRAFT';

  return (
    <form action={action} className="space-y-8" noValidate>
      {state.status === 'error' && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {deal ? <input type="hidden" name="id" value={deal.id} /> : <ClientIdField name="clientRequestId" />}

      <Section title="Angebot">
        <Field label="Titel" hint="Produkt bzw. Angebot, z. B. „Notebook 15 Zoll, 16 GB RAM“" error={errors.title} required>
          <Input name="title" maxLength={120} defaultValue={v?.title ?? deal?.title} />
        </Field>
        <Field label="Kategorie" error={errors.categorySlug} required>
          <Select name="categorySlug" defaultValue={v?.categorySlug ?? deal?.category.slug ?? ''}>
            <option value="">Bitte wählen</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Beschreibung" hint="Sachliche Angaben zum Angebot. Bitte keine Kontaktdaten oder Links." error={errors.description}>
          <Textarea name="description" rows={5} maxLength={3000} defaultValue={v?.description ?? deal?.description} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Marke" error={errors.brand}>
            <Input name="brand" maxLength={60} defaultValue={v?.brand ?? deal?.brand ?? ''} />
          </Field>
          <Field label="GTIN/EAN" hint="optional" error={errors.gtin}>
            <Input name="gtin" inputMode="numeric" maxLength={14} defaultValue={v?.gtin ?? deal?.gtin ?? ''} />
          </Field>
          <Field label="Eigene Artikelnummer" hint="für CSV-Importe" error={errors.externalId}>
            <Input name="externalId" maxLength={100} defaultValue={v?.externalId ?? externalId ?? ''} />
          </Field>
        </div>
      </Section>

      <Section title="Preis">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Angebotspreis in € (inkl. USt.)" hint="z. B. 599 oder 1.299,90" error={errors.price ?? errors.priceCents} required>
            <Input name="price" inputMode="decimal" defaultValue={v?.price ?? centsToInput(deal?.priceCents)} autoComplete="off" />
          </Field>
          <Field label="Grundpreis" hint="z. B. „€ 2,49 / kg“, falls vorgeschrieben" error={errors.unitPriceText}>
            <Input name="unitPriceText" maxLength={40} defaultValue={v?.unitPriceText ?? deal?.unitPriceText ?? ''} />
          </Field>
        </div>
        <Field label="Versand" hint="z. B. „zzgl. € 4,90 Versand“ oder „versandkostenfrei“" error={errors.shippingNote}>
          <Input name="shippingNote" maxLength={120} defaultValue={v?.shippingNote ?? deal?.shippingNote ?? ''} />
        </Field>

        <fieldset className="space-y-2 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-ink-900">Vergleichspreis (optional)</legend>
          <p className="text-sm text-ink-600">
            Ein Rabatt erscheint nur mit belegbarem Vergleichspreis. Bei einer Preisermäßigung ist das in der Regel der niedrigste Preis, den du in den 30 Tagen davor verlangt
            hast. Eine UVP ist nur mit Quelle zulässig. Erfundene Vergleichspreise führen zur Sperre.
          </p>
          {(
            [
              ['', 'Kein Vergleichspreis'],
              ['LOWEST_30_DAYS', REFERENCE_PRICE_LABELS.LOWEST_30_DAYS],
              ['RRP', REFERENCE_PRICE_LABELS.RRP],
            ] as [string, string][]
          ).map(([value, label]) => (
            <label key={value || 'none'} className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
              <input type="radio" name="referenceType" value={value} checked={referenceType === value} onChange={() => setReferenceType(value)} className="size-4.5 accent-brand-700" />
              {label}
            </label>
          ))}
          {errors.referenceType ? <p className="text-sm font-medium text-danger-600">{errors.referenceType[0]}</p> : null}
          {referenceType ? (
            <div className="space-y-4 pt-3">
              <Field label="Vergleichspreis in €" error={errors.referencePrice} required>
                <Input name="referencePrice" inputMode="decimal" defaultValue={v?.referencePrice ?? centsToInput(deal?.referencePriceCents)} autoComplete="off" />
              </Field>
              <Field
                label="Quelle"
                hint={referenceType === 'RRP' ? 'Pflicht, z. B. „UVP laut Hersteller, Preisliste 10/2026“' : 'optional, z. B. „eigener Onlineshop 1.–30.10.2026“'}
                error={errors.referencePriceSource}
                required={referenceType === 'RRP'}
              >
                <Input name="referencePriceSource" maxLength={200} defaultValue={v?.referencePriceSource ?? deal?.referencePriceSource ?? ''} />
              </Field>
              <Field label="Link zum Beleg" hint="optional, nur https" error={errors.referencePriceEvidenceUrl}>
                <Input name="referencePriceEvidenceUrl" type="url" maxLength={500} defaultValue={v?.referencePriceEvidenceUrl ?? deal?.referencePriceEvidenceUrl ?? ''} />
              </Field>
              <div>
                <Checkbox name="referenceConfirmed" label="Ich bestätige, dass der Vergleichspreis stimmt und ich ihn auf Nachfrage belegen kann." />
                {errors.referenceConfirmed ? <p className="mt-1 text-sm font-medium text-danger-600">{errors.referenceConfirmed[0]}</p> : null}
              </div>
            </div>
          ) : null}
        </fieldset>
      </Section>

      <Section title="Wo gilt das Angebot?">
        <fieldset className="space-y-2">
          <legend className="sr-only">Kanal</legend>
          {DEAL_CHANNELS.map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-3 text-sm text-ink-800">
              <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="size-4.5 accent-brand-700" />
              {DEAL_CHANNEL_LABELS[c]}
            </label>
          ))}
        </fieldset>
        {channel !== 'LOCAL' ? (
          <>
            <Field label="Link zum Angebot" hint="https-Adresse der Angebotsseite in deinem Shop" error={errors.url} required>
              <Input name="url" type="url" maxLength={500} placeholder="https://" defaultValue={v?.url ?? deal?.url ?? ''} />
            </Field>
            <Checkbox
              name="isAffiliateLink"
              defaultChecked={deal?.isAffiliateLink}
              label="Das ist ein Provisions- bzw. Affiliate-Link (wird als „Werbelink“ gekennzeichnet)."
            />
          </>
        ) : null}
        {channel !== 'ONLINE' ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink-900">
              Filialen<span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>
            </legend>
            {stores.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {stores.map((store) => (
                  <label key={store.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
                    <input type="checkbox" name="storeIds" value={store.id} defaultChecked={selectedStores.has(store.id)} className="mt-0.5 size-4.5 shrink-0 accent-brand-700" />
                    <span>
                      <span className="font-semibold text-ink-900">{store.name}</span>
                      <span className="block text-ink-600">
                        {store.street}, {store.location.postalCode} {store.location.place}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-600">Du hast noch keine Filialen angelegt.</p>
            )}
            {errors.storeIds ? <p className="text-sm font-medium text-danger-600">{errors.storeIds[0]}</p> : null}
            <Link href="/konto/deals/filialen" className="inline-block text-sm font-semibold text-brand-700 hover:underline">
              Filialen verwalten
            </Link>
          </fieldset>
        ) : null}
      </Section>

      <Section title="Zeitraum und Verfügbarkeit">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gültig ab" error={errors.startsOn} required>
            <Input name="startsOn" type="date" min={isDraft ? today : undefined} defaultValue={v?.startsOn ?? (deal ? toViennaDay(new Date(deal.startsAt)) : today)} />
          </Field>
          <Field label="Gültig bis (einschließlich)" hint={`höchstens ${DEAL_MAX_DURATION_DAYS} Tage, später verlängerbar`} error={errors.endsOn} required>
            <Input name="endsOn" type="date" min={today} defaultValue={v?.endsOn ?? (deal ? toViennaDay(new Date(deal.endsAt)) : '')} />
          </Field>
        </div>
        <Field label="Verfügbarkeit" hint="Nur angeben, wenn du es zuverlässig weißt." error={errors.availability}>
          <Select name="availability" defaultValue={v?.availability ?? deal?.availability ?? 'UNKNOWN'}>
            {DEAL_AVAILABILITIES.map((a) => (
              <option key={a} value={a}>{DEAL_AVAILABILITY_LABELS[a]}</option>
            ))}
          </Select>
        </Field>
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        {isDraft ? (
          <>
            <SubmitButton name="intent" value="publish" disabled={!canPublish}>
              Veröffentlichen
            </SubmitButton>
            <SubmitButton name="intent" value="save" variant="outline">
              Als Entwurf speichern
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="save">
            Änderungen speichern
          </SubmitButton>
        )}
      </div>
      {isDraft && !canPublish ? <p className="text-sm text-ink-600">Veröffentlichen kannst du, sobald die Voraussetzungen oben erfüllt sind.</p> : null}
      {!isDraft ? <p className="text-xs text-ink-500">Jede Änderung gilt zugleich als Bestätigung, dass das Angebot noch stimmt („Zuletzt geprüft“).</p> : null}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-sans text-lg font-semibold tracking-normal text-ink-950">{title}</h2>
      {children}
    </section>
  );
}
