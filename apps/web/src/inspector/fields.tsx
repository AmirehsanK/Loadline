import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface FieldShell {
  label: string;
  hint?: string;
}

function Field({ id, label, hint, hideLabel = false, children }: FieldShell & { id: string; hideLabel?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-[0.85rem] text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, value, onChange }: FieldShell & { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field id={id} label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        id={id}
        className="field-input font-sans!"
        value={value}
        maxLength={80}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

interface NumberFieldProps extends FieldShell {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Whole numbers only. */
  integer?: boolean;
  unit?: string;
  /** Keep the label for screen readers only, when something next to the field already says it. */
  hideLabel?: boolean;
  onChange: (value: number) => void;
}

/**
 * A number with bounds. The text follows what is typed, including a half-finished or out-of-range
 * entry, but only a valid number is passed on; leaving the field restores the last valid one.
 */
export function NumberField({ label, hint, value, min, max, step = 1, integer = false, unit, hideLabel = false, onChange }: NumberFieldProps) {
  const id = useId();
  // What is being typed, while the field has focus. Otherwise the field shows the value itself,
  // so it follows changes made elsewhere.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);

  const accepts = (candidate: string) => {
    const number = Number(candidate);
    return (
      candidate.trim() !== '' &&
      Number.isFinite(number) &&
      number >= min &&
      number <= max &&
      (!integer || Number.isInteger(number))
    );
  };
  const valid = accepts(text);

  return (
    <Field id={id} label={label} hideLabel={hideLabel} {...(hint === undefined ? {} : { hint })}>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          className={`field-input ${unit === undefined ? '' : 'pe-10'}`}
          value={text}
          min={min}
          max={max}
          step={step}
          aria-invalid={!valid}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onFocus={() => {
            setDraft(String(value));
          }}
          onBlur={() => {
            setDraft(null);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (accepts(next)) onChange(Number(next));
          }}
        />
        {unit !== undefined && (
          <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center font-mono text-[0.85rem] text-ink-3">
            {unit}
          </span>
        )}
      </div>
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: FieldShell & { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId();
  return (
    <Field id={id} label={label} {...(hint === undefined ? {} : { hint })}>
      <select
        id={id}
        className="field-input font-sans!"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ToggleField({ label, hint, value, onChange }: FieldShell & { value: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-ink"
          checked={value}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-[0.85rem] text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}
