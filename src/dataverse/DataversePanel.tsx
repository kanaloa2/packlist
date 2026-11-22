import { useEffect, useRef, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { checkConfig, loadConfig, saveConfig, type DataverseConfig } from './config';
import { currentAccount, friendlyAuthError, signIn, signOut } from './auth';
import { describeTables, listTables, matchesPrefix, summaryText, type TableInfo } from './api';
import { applyPlan, buildPlan, fetchSource, type Plan } from './importer';
import { useAuth } from '../auth/AuthGate';
import { Link } from 'react-router-dom';

/**
 * Settings → Import from Dataverse: connect with Microsoft, preview what will come across
 * from the PackList Dataverse app, then import it. An advanced section can copy the
 * structure of any tables (no row data) for troubleshooting.
 */
export function DataversePanel() {
  const [config, setConfig] = useState<DataverseConfig>(loadConfig);
  const [editing, setEditing] = useState(() => checkConfig(loadConfig()) !== null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilterState] = useState(() => readFilter());
  const setFilter = (f: string) => {
    setFilterState(f);
    writeFilter(f);
  };
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const { session } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<string>('');
  // Bumped by Cancel so a sign-in that finishes later is ignored.
  const [, setAttempt] = useState(0);
  const attemptRef = useRef(0);

  const problem = checkConfig(config);

  useEffect(() => {
    if (editing || problem) return;
    currentAccount(config)
      .then(setAccount)
      .catch(() => setAccount(null));
    // Re-check only when the saved configuration changes.
  }, [editing, config.clientId, config.tenantId]);

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    const mine = attemptRef.current;
    setBusy(what);
    setError('');
    try {
      const result = await fn();
      return attemptRef.current === mine ? result : undefined;
    } catch (e) {
      if (attemptRef.current === mine) setError(friendlyAuthError(e));
    } finally {
      if (attemptRef.current === mine) setBusy('');
    }
  }

  async function loadTables() {
    const list = await run('Loading your tables…', () => listTables(config));
    if (list) {
      setTables(list);
      // Nothing is pre-ticked unless a filter is already set, then its matches are.
      setChosen(new Set(filter.trim() ? list.filter((t) => matchesPrefix(t, filter)).map((t) => t.logicalName) : []));
    }
  }

  async function connect() {
    const acct = await run('Waiting for Microsoft sign-in…', () => signIn(config));
    if (acct) setAccount(acct);
  }

  /** Progress messages for the current attempt only (ignored after Cancel). */
  function progress() {
    const mine = attemptRef.current;
    return (msg: string) => attemptRef.current === mine && setBusy(msg);
  }

  async function preview() {
    setDone('');
    setPlan(null);
    const say = progress();
    const p = await run('Reading your PackList data…', async () => buildPlan(await fetchSource(config, {}, say), session.user.id));
    if (p) setPlan(p);
  }

  async function doImport() {
    if (!plan) return;
    setImporting(true);
    const say = progress();
    const r = await run('Importing…', () => applyPlan(config, plan, { includePhotos, onProgress: say }));
    setImporting(false);
    if (r) {
      setDone(
        `Imported ${plan.trips.length} trip${plan.trips.length === 1 ? '' : 's'}, ${plan.activities.length} activities and ${plan.items.length} items` +
          (includePhotos ? ` with ${r.photos} photo${r.photos === 1 ? '' : 's'}` : '') +
          (r.photoFailures ? ` (${r.photoFailures} photo${r.photoFailures === 1 ? '' : 's'} couldn’t be downloaded)` : '') +
          '. It’s syncing to your account now.',
      );
      setPlan(null);
    }
  }

  async function describe() {
    const picked = (tables ?? []).filter((t) => chosen.has(t.logicalName));
    const result = await run(`Reading ${picked.length} table${picked.length === 1 ? '' : 's'}…`, () => describeTables(config, picked));
    if (result) setSummary(summaryText(config.envUrl, result));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Couldn’t copy automatically — select the text below and copy it.');
    }
  }

  const matching = (tables ?? []).filter((t) => matchesPrefix(t, filter));
  // Ticked tables stay visible even if they don't match the filter, so nothing is selected out of sight.
  const visible = [...matching, ...(tables ?? []).filter((t) => chosen.has(t.logicalName) && !matchesPrefix(t, filter))];
  const LIMIT = 150;
  const shown = visible.slice(0, LIMIT);

  return (
    <section className="panel">
      <h2>Import from Dataverse</h2>
      <p className="muted">
        Bring in trips, destinations, places, activities and items from your PackList app in Dataverse. You’ll see a
        preview first. Importing again later updates what was imported instead of making copies.
      </p>

      {editing ? (
        <form
          className="form dv-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return setError(problem);
            const clean = { envUrl: config.envUrl.trim(), clientId: config.clientId.trim(), tenantId: config.tenantId.trim() };
            saveConfig(clean);
            setConfig(clean);
            setEditing(false);
            setError('');
          }}
        >
          <div className="field">
            <label className="label" htmlFor="dv-env">
              Environment URL
            </label>
            <input id="dv-env" type="text" value={config.envUrl} onChange={(e) => setConfig({ ...config, envUrl: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="dv-client">
              Application (client) ID
            </label>
            <input
              id="dv-client"
              type="text"
              placeholder="From your Entra app registration’s Overview page"
              value={config.clientId}
              onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="dv-tenant">
              Directory (tenant) ID
            </label>
            <input
              id="dv-tenant"
              type="text"
              placeholder="Also on the Overview page"
              value={config.tenantId}
              onChange={(e) => setConfig({ ...config, tenantId: e.target.value })}
            />
          </div>
          <div className="row-actions">
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="small">
            {config.envUrl.replace(/^https:\/\//, '')}
            {account ? ` · signed in as ${account.username}` : ''}{' '}
            <button className="link-btn" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
          <div className="row-actions">
            {account ? (
              <>
                <button className="btn btn-primary" disabled={!!busy} onClick={preview}>
                  {plan ? 'Refresh preview' : 'Preview import'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={async () => {
                    await run('Signing out…', () => signOut(config));
                    setAccount(null);
                    setTables(null);
                    setSummary('');
                    setPlan(null);
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={!!busy} onClick={connect}>
                Sign in with Microsoft
              </button>
            )}
          </div>
        </>
      )}

      {busy && (
        <p className="muted small" role="status">
          {busy}{' '}
          {!importing && (
          <button
            className="link-btn"
            onClick={() => {
              attemptRef.current++;
              setAttempt(attemptRef.current);
              setBusy('');
            }}
          >
            Cancel
          </button>
          )}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {done && (
        <p className="success" role="status">
          {done} <Link to="/">See your trips →</Link>
        </p>
      )}

      {plan && !busy && <ImportPreview plan={plan} includePhotos={includePhotos} setIncludePhotos={setIncludePhotos} onImport={doImport} />}

      {account && !editing && (
        <details className="dv-advanced">
          <summary>Advanced: copy table details</summary>
          <p className="muted small">Lists any tables’ columns and links (no row data), for troubleshooting.</p>
          <button className="btn btn-small btn-ghost" disabled={!!busy} onClick={loadTables}>
            {tables ? 'Reload tables' : 'Show my tables'}
          </button>
      {tables && !summary && (
        <div className="dv-tables">
          {tables.length === 0 ? (
            <p className="small">No custom tables found in this environment.</p>
          ) : (
            <>
              <p className="small">
                Choose the tables that hold your trips, destinations, places, activities and items (and any table linking
                items to activities).
              </p>
              <div className="field dv-filter">
                <label className="label" htmlFor="dv-filter">
                  Table name starts with
                </label>
                <input
                  id="dv-filter"
                  type="search"
                  placeholder="e.g. PackList"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="dv-select-bar">
                <span className="muted small">
                  {matching.length} of {tables.length} tables match · {chosen.size} selected
                </span>
                <button
                  className="btn btn-small btn-secondary"
                  disabled={!matching.length || (filter.trim() === '' && matching.length > LIMIT)}
                  onClick={() => setChosen(new Set([...chosen, ...matching.map((t) => t.logicalName)]))}
                >
                  Select all {matching.length} shown
                </button>
                <button className="btn btn-small btn-ghost" disabled={!chosen.size} onClick={() => setChosen(new Set())}>
                  Clear
                </button>
              </div>
            </>
          )}
          <ul className="dv-table-list">
            {shown.map((t) => (
              <li key={t.logicalName}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={chosen.has(t.logicalName)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(t.logicalName);
                      else next.delete(t.logicalName);
                      setChosen(next);
                    }}
                  />
                  {t.displayName} <span className="muted small">{t.logicalName}</span>
                </label>
              </li>
            ))}
          </ul>
          {visible.length > shown.length && (
            <p className="muted small">
              Showing the first {LIMIT} of {visible.length}. Type the start of your table names above to narrow the list.
            </p>
          )}
          <div className="row-actions">
            <button className="btn btn-primary" disabled={!chosen.size || !!busy} onClick={describe}>
              Get table details
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="dv-summary">
          <p className="small">
            Here’s the structure of those tables — column names, types and links between tables, <strong>no trip data</strong>.
            Copy it and send it to finish setting up the importer.
          </p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy table details'}
            </button>
            <button className="btn btn-ghost" onClick={() => setSummary('')}>
              Pick different tables
            </button>
          </div>
          <textarea className="dv-output" readOnly value={summary} rows={10} onFocus={(e) => e.target.select()} />
        </div>
      )}
        </details>
      )}
    </section>
  );
}

function ImportPreview({
  plan,
  includePhotos,
  setIncludePhotos,
  onImport,
}: {
  plan: Plan;
  includePhotos: boolean;
  setIncludePhotos: (v: boolean) => void;
  onImport: () => void;
}) {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const packed = plan.packStatus.filter((s) => s.packed).length;
  const tripOnly = plan.tripOnlyItems.reduce((sum, t) => sum + t.items.length, 0);
  return (
    <div className="dv-preview">
      <h3>Ready to import</h3>
      <ul className="dv-counts">
        <li>{n(plan.trips.length, 'trip')}</li>
        <li>{n(plan.destinations.length, 'destination')}</li>
        <li>{n(plan.places.length, 'place')}</li>
        <li>{n(plan.activities.length, 'activity', 'activities')}</li>
        <li>{n(plan.items.length, 'item')}</li>
        <li>{n(plan.activityItems.length, 'item on an activity', 'items on activities')}</li>
        <li>{n(packed, 'packed tick')}</li>
      </ul>
      <p className="muted small">
        Trips: {plan.trips.map((t) => t.name).join(', ') || 'none'}. Destinations used on more than one trip are copied into
        each trip.
      </p>
      {plan.warnings.length > 0 && (
        <details className="dv-notes">
          <summary>
            {n(plan.warnings.length, 'thing', 'things')} to know
          </summary>
          <ul>
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {tripOnly > 0 && (
        <details className="dv-notes">
          <summary>
            {n(tripOnly, 'item is', 'items are')} linked to a trip but not to any of its activities
          </summary>
          <p className="small">
            Packlist builds the packing list from activities, so these won’t appear on a packing list until you add them to
            an activity. They’re still imported into your item library.
          </p>
          <ul>
            {plan.tripOnlyItems.map((t) => (
              <li key={t.trip}>
                <strong>{t.trip}:</strong> {t.items.join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      <label className="toggle">
        <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
        Include photos ({plan.photos.length})
      </label>
      <div className="row-actions">
        <button className="btn btn-primary" onClick={onImport}>
          Import
        </button>
      </div>
    </div>
  );
}

const FILTER_KEY = 'packlist.dataverse.filter';

function readFilter(): string {
  try {
    return localStorage.getItem(FILTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeFilter(f: string) {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* storage unavailable */
  }
}
