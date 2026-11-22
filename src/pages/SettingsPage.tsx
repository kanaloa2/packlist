import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { deleteAllData, exportBackup, importBackup, parseBackup } from '../lib/backup';
import { useAuth } from '../auth/AuthGate';
import { Modal } from '../components/Modal';
import { DataversePanel } from '../dataverse/DataversePanel';
import { supabase } from '../supabase';
import { sync, useSyncStatus } from '../sync';
import { createSampleTrip } from '../lib/sample';
import { todayYmd } from '../lib/dates';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const syncStatus = useSyncStatus();
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
        <h2>Account</h2>
        <p>
          Signed in as <strong>{session.user.email}</strong>
        </p>
        <p className="muted small">
          {syncStatus.pending
            ? `${syncStatus.pending} change${syncStatus.pending === 1 ? '' : 's'} waiting to sync.`
            : syncStatus.lastSyncedAt
              ? `Everything is synced (last checked ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}).`
              : 'Syncing…'}
          {syncStatus.rejected > 0 &&
            ` ${syncStatus.rejected} change${syncStatus.rejected === 1 ? ' was' : 's were'} rejected by the server (usually because something was deleted on another device).`}
        </p>
        <div className="row-actions">
          <button className="btn btn-secondary" onClick={() => sync.syncNow()}>
            Sync now
          </button>
          <ChangePassword />
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Your data</h2>
        <p className="muted">
          Your trips, items and photos are saved to your account, so you can sign in on any device. This device also
          keeps a copy, so Packlist works offline — changes sync when you’re back online. Only you can see your data.
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

      <DataversePanel />

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
        <p className="muted">Permanently deletes all your trips and items, on every device. Your account stays.</p>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (confirm('Delete ALL your trips and items, on every device? This cannot be undone.')) {
              await deleteAllData();
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

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const close = () => {
    setOpen(false);
    setPw('');
    setError('');
  };
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        {done ? 'Password updated ✓' : 'Change password'}
      </button>
      <Modal open={open} title="Change password" onClose={close}>
        <form
          className="form"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 8) return setError('Passwords must be at least 8 characters.');
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) return setError(error.message);
            setDone(true);
            close();
          }}
        >
          <div className="field">
            <label className="label" htmlFor="change-pw">
              New password
            </label>
            <input id="change-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <p className="hint">At least 8 characters.</p>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save password
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
