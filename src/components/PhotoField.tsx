import { useRef, useState } from 'react';
import { resizeImage } from '../lib/photo';

interface Props {
  value?: string;
  onChange: (value: string | undefined) => void;
}

export function PhotoField({ value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await resizeImage(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="photo-field">
      {value ? (
        <img src={value} alt="" className="photo-preview" />
      ) : (
        <div className="photo-preview photo-empty" aria-hidden>
          📷
        </div>
      )}
      <div className="photo-actions">
        <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Processing…' : value ? 'Change photo' : 'Add photo'}
        </button>
        {value && (
          <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
        data-testid="photo-input"
      />
    </div>
  );
}
