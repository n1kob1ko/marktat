import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const control =
  'block w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[0.9375rem] text-ink-900 ' +
  'placeholder:text-ink-400 transition-colors hover:border-ink-400 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-500 ' +
  'aria-invalid:border-danger-600 aria-invalid:focus:ring-danger-600/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, 'h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, 'min-h-32 py-3 leading-relaxed', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          control,
          'select-chevron h-11',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-semibold text-ink-900', className)} {...props} />;
}

export interface FieldProps {
  label: ReactNode;
  /** Das Eingabeelement; id, aria-describedby und aria-invalid werden automatisch gesetzt. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: string | string[];
  required?: boolean;
  className?: string;
}

/** Beschriftetes Formularfeld mit Hinweis- und Fehlertext, korrekt per ARIA verknüpft. */
export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const generatedId = useId();
  const id = (children.props.id as string | undefined) ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorText = Array.isArray(error) ? error[0] : error;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {isValidElement(children)
        ? cloneElement(children, {
            id,
            'aria-describedby': describedBy,
            'aria-invalid': errorText ? true : undefined,
            required: required || undefined,
          })
        : children}
      {hint ? (
        <p id={hintId} className="text-sm text-ink-500">
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} className="text-sm font-medium text-danger-600">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={props.id ?? id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 rounded-md border-line-strong accent-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        {...props}
      />
      <label htmlFor={props.id ?? id} className="text-sm leading-relaxed text-ink-700">
        {label}
      </label>
    </div>
  );
}
