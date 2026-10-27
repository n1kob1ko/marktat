'use client';

import { Checkbox, cn, Field, Input, Select } from '@marktat/ui';
import type { AttributeField, CategoryAttributeSchema, ListingAttributes } from '@marktat/shared';

/** Eingabewerte im Formular: Texte, bei Mehrfachauswahl Listen. */
export type AttributeInputValues = Record<string, string | string[]>;

const numberInput = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Gespeicherte Werte in Formulartext umwandeln (72.5 → „72,5“, 85000 → „85.000“). */
export function attributesToInput(attributes: ListingAttributes | undefined): AttributeInputValues {
  const result: AttributeInputValues = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (Array.isArray(value)) result[key] = value;
    // Jahresfelder (…Year) ohne Tausenderpunkt
    else if (typeof value === 'number') result[key] = /Year$/.test(key) ? String(value) : numberInput.format(value);
    else result[key] = String(value);
  }
  return result;
}

function fieldLabel(field: AttributeField) {
  return field.kind === 'number' && field.unit ? `${field.label} (${field.unit})` : field.label;
}

interface AttributeFieldsProps {
  schema: CategoryAttributeSchema;
  values: AttributeInputValues;
  onChange: (key: string, value: string | string[]) => void;
  errors: Record<string, string[] | undefined>;
}

/**
 * Zusatzfelder der gewählten Kategorie. Es werden nur die Felder dieser Kategorie gerendert und damit
 * abgeschickt; Werte einer vorher gewählten Kategorie bleiben im Browser, werden aber nicht gespeichert.
 */
export function AttributeFields({ schema, values, onChange, errors }: AttributeFieldsProps) {
  if (!schema.fields.length) return null;
  return (
    <div className="space-y-4 border-t border-line pt-5">
      <div>
        <h3 className="font-sans text-base font-semibold tracking-normal text-ink-900">Details</h3>
        <p className="mt-1 text-sm text-ink-500">
          Mit <span className="text-danger-600">*</span> markierte Angaben brauchst du zum Veröffentlichen, Entwürfe dürfen unvollständig sein.
        </p>
      </div>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        {schema.fields.map((field) => (
          <AttributeInput
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(value) => onChange(field.key, value)}
            error={errors[`attributes.${field.key}`]}
          />
        ))}
      </div>
    </div>
  );
}

function AttributeInput({
  field,
  value,
  onChange,
  error,
}: {
  field: AttributeField;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  error?: string[];
}) {
  const name = `attr.${field.key}`;
  const text = typeof value === 'string' ? value : '';

  switch (field.kind) {
    case 'select': {
      if (field.fixed) {
        const label = field.options.find((o) => o.value === field.fixed)?.label ?? field.fixed;
        return (
          <Field label={field.label} hint="Ergibt sich aus der Kategorie.">
            <Input value={label} readOnly disabled />
          </Field>
        );
      }
      // Wert aus einer anderen Kategorie, den es hier nicht gibt, nicht als Auswahl übernehmen
      const selected = field.options.some((o) => o.value === text) ? text : '';
      return (
        <Field label={field.label} hint={field.hint} error={error} required={field.required}>
          <Select name={name} value={selected} onChange={(e) => onChange(e.target.value)}>
            <option value="">{field.required ? 'Bitte wählen …' : 'Keine Angabe'}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset className="space-y-2 sm:col-span-2" aria-describedby={error ? `${name}-error` : undefined}>
          <legend className="text-sm font-semibold text-ink-900">{field.label}</legend>
          <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {field.options.map((option) => (
              <Checkbox
                key={option.value}
                name={name}
                value={option.value}
                label={option.label}
                checked={selected.includes(option.value)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))
                }
              />
            ))}
          </div>
          {error?.[0] ? (
            <p id={`${name}-error`} className="text-sm font-medium text-danger-600">
              {error[0]}
            </p>
          ) : null}
        </fieldset>
      );
    }
    case 'boolean':
      return (
        <div className="self-end sm:col-span-2">
          <Checkbox name={name} value="true" label={field.label} checked={text === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />
          {error?.[0] ? <p className="mt-1 text-sm font-medium text-danger-600">{error[0]}</p> : null}
        </div>
      );
    default: {
      const numeric = field.kind === 'number' || field.kind === 'year';
      return (
        <Field label={fieldLabel(field)} hint={field.hint} error={error} required={field.required}>
          <Input
            name={name}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            inputMode={numeric ? (field.kind === 'number' && field.decimals > 0 ? 'decimal' : 'numeric') : undefined}
            maxLength={field.kind === 'text' ? field.maxLength : field.kind === 'year' ? 4 : 16}
            placeholder={field.placeholder ?? (field.kind === 'year' ? 'z. B. 2019' : undefined)}
            autoComplete="off"
            className={cn(numeric && 'tabular-nums')}
          />
        </Field>
      );
    }
  }
}
