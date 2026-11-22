import { useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { PhotoField } from './PhotoField';
import { ValidationError } from '../lib/repo';

export type FieldDef =
  | { key: string; label: string; type: 'text'; required?: boolean; placeholder?: string; autoFocus?: boolean }
  | { key: string; label: string; type: 'textarea'; placeholder?: string; hint?: string }
  | { key: string; label: string; type: 'date' | 'datetime'; required?: boolean; min?: string; max?: string; hint?: string }
  | {
      key: string;
      label: string;
      type: 'select';
      options: readonly string[];
      icons?: Record<string, string>;
      /** Display text per option value (defaults to the value itself). */
      labels?: Record<string, string>;
      hint?: string;
    }
  | { key: string; label: string; type: 'photo' }
  /** Pick one of `options` as a chip, or type your own value. */
  | { key: string; label: string; type: 'combo'; options: readonly string[]; placeholder?: string; hint?: string };

export type Values = Record<string, string | undefined>;

interface Props {
  open: boolean;
  title: string;
  fields: FieldDef[];
  /** Starting values; non-string fields (ids, timestamps) are ignored. */
  initial: object;
  submitLabel?: string;
  onClose: () => void;
  /** Throw ValidationError to show a message next to a field. */
  onSubmit: (values: Values) => Promise<void>;
  /** Lets a form adjust values as the user types (e.g. keep end ≥ start). */
  onValuesChange?: (next: Values, prev: Values) => Values;
}

export function EntityDialog({ open, title, onClose, ...rest }: Props) {
  // The Modal only renders its children while open, so the form below mounts fresh
  // (with fresh state from `initial`) every time the dialog opens.
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <EntityForm {...rest} onClose={onClose} />
    </Modal>
  );
}

function EntityForm({
  fields,
  initial,
  submitLabel = 'Save',
  onClose,
  onSubmit,
  onValuesChange,
}: Omit<Props, 'open' | 'title'>) {
  const [values, setValues] = useState<Values>(initial as Values);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function set(key: string, v: string | undefined) {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      return onValuesChange ? onValuesChange(next, prev) : next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      if (err instanceof ValidationError) setError({ field: err.field, message: err.message });
      else setError({ message: (err as Error).message || 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: string) =>
    error?.field === key ? (
      <p className="field-error" role="alert">
        {error.message}
      </p>
    ) : null;
  const knownField = error?.field && fields.some((f) => f.key === error.field);

  return (
    <form onSubmit={submit} className="form" noValidate>
        {fields.map((f) => {
          const id = `f-${f.key}`;
          const v = values[f.key] ?? '';
          switch (f.type) {
            case 'photo':
              return (
                <div className="field" key={f.key}>
                  <span className="label">{f.label}</span>
                  <PhotoField value={values[f.key]} onChange={(p) => set(f.key, p)} />
                </div>
              );
            case 'textarea':
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id} className="label">
                    {f.label}
                  </label>
                  <textarea id={id} value={v} rows={3} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                  {f.hint && <p className="hint">{f.hint}</p>}
                  {fieldError(f.key)}
                </div>
              );
            case 'combo': {
              const lower = v.trim().toLowerCase();
              return (
                <div className="field" key={f.key}>
                  <span className="label" id={`${id}-label`}>
                    {f.label}
                  </span>
                  <div className="chips chips-wrap" role="radiogroup" aria-labelledby={`${id}-label`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!lower}
                      className={`chip${!lower ? ' active' : ''}`}
                      onClick={() => set(f.key, '')}
                    >
                      None
                    </button>
                    {f.options.map((o) => {
                      const on = o.toLowerCase() === lower;
                      return (
                        <button key={o} type="button" role="radio" aria-checked={on} className={`chip${on ? ' active' : ''}`} onClick={() => set(f.key, o)}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    id={id}
                    type="text"
                    value={v}
                    placeholder={f.placeholder}
                    aria-label={`${f.label} (type your own)`}
                    maxLength={60}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {f.hint && <p className="hint">{f.hint}</p>}
                  {fieldError(f.key)}
                </div>
              );
            }
            case 'select':
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id} className="label">
                    {f.label}
                  </label>
                  <select id={id} value={v} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {f.icons?.[o] ? `${f.icons[o]}  ` : ''}
                        {f.labels?.[o] ?? o}
                      </option>
                    ))}
                  </select>
                  {f.hint && <p className="hint">{f.hint}</p>}
                  {fieldError(f.key)}
                </div>
              );
            case 'date':
            case 'datetime':
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id} className="label">
                    {f.label}
                  </label>
                  <input
                    id={id}
                    type={f.type === 'date' ? 'date' : 'datetime-local'}
                    value={v}
                    min={f.min}
                    max={f.max}
                    required={f.required}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {f.hint && <p className="hint">{f.hint}</p>}
                  {fieldError(f.key)}
                </div>
              );
            default:
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={id} className="label">
                    {f.label}
                  </label>
                  <input
                    id={id}
                    type="text"
                    value={v}
                    placeholder={f.placeholder}
                    required={f.required}
                    autoFocus={f.autoFocus}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {fieldError(f.key)}
                </div>
              );
          }
        })}
        {error && !knownField && (
          <p className="field-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
    </form>
  );
}
