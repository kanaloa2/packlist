import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ALL_TABLES } from '../db';
import { exportBackup, importBackup, parseBackup } from '../lib/backup';
import { createSampleTrip } from '../lib/sample';
import { todayYmd } from '../lib/dates';

export function SettingsPage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const counts = useLiveQuery(async () => ({
    trips: await db.trips.count(),
    items: await db.items.count(),
    activities: await db.activities.count(),
  }));

  async function doExport() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packlist-backup-${todayYmd()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ kind: 'ok', text: 'Backup downloaded.' });
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const replace = confirm(
        'Replace all current data with this backup?\n\nOK = replace everything\nCancel = merge it into your current data',
      );
      const n = await importBackup(backup, replace ? 'replace' : 'merge');
      setStatus({ kind: 'ok', text: `Imported ${n} records (${replace ? 'replaced' : 'merged'}).` });
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="panel">
        <h2>Your data</h2>
        <p className="muted">
          Packlist stores everything — including photos — on this device, in your browser. It works offline and nothing
          is uploaded anywhere. Export a backup to keep it safe or move it to another device.
        </p>
        {counts && (
          <p className="small">
            {counts.trips} trips · {counts.activities} activities · {counts.items} items
          </p>
        )}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={doExport}>
            Export backup
          </button>
          <button className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
            Import backup
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
        </div>
        {status && (
          <p className={status.kind === 'ok' ? 'success' : 'field-error'} role="status">
            {status.text}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Sample trip</h2>
        <p className="muted">Adds an example Las Vegas &amp; New York trip with places, activities and items.</p>
        <button className="btn btn-secondary" onClick={async () => navigate(`/trips/${await createSampleTrip()}`)}>
          Add sample trip
        </button>
      </section>

      <section className="panel">
        <h2>Install</h2>
        <p className="muted">
          Add Packlist to your home screen for an app-like experience: in Safari tap Share → “Add to Home Screen”; in
          Chrome use the menu → “Install app”.
        </p>
      </section>

      <section className="panel danger-zone">
        <h2>Danger zone</h2>
        <p className="muted">Permanently deletes all trips, items and photos on this device.</p>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (confirm('Delete ALL Packlist data on this device? This cannot be undone.')) {
              await db.transaction('rw', [...ALL_TABLES], async () => {
                for (const t of ALL_TABLES) await db.table(t).clear();
              });
              setStatus(null);
              navigate('/');
            }
          }}
        >
          Delete all data
        </button>
      </section>
    </div>
  );
}
