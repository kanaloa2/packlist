import { useEffect, useRef, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { checkConfig, loadConfig, saveConfig, type DataverseConfig } from './config';
import { currentAccount, friendlyAuthError, signIn, signOut } from './auth';
import { describeTables, listTables, looksRelevant, summaryText, type TableInfo } from './api';

/**
 * Settings → Dataverse. Step 1 of the Dataverse import: connect, pick the tables that hold
 * your trips, and copy their structure (no row data) so the importer can be matched to them.
 */
export function DataversePanel() {
  const [config, setConfig] = useState<DataverseConfig>(loadConfig);
  const [editing, setEditing] = useState(() => checkConfig(loadConfig()) !== null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
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
      setChosen(new Set(list.filter(looksRelevant).map((t) => t.logicalName)));
    }
  }

  async function connect() {
    const acct = await run('Waiting for Microsoft sign-in…', () => signIn(config));
    if (acct) {
      setAccount(acct);
      await loadTables();
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

  const visible = (tables ?? []).filter((t) => showAll || looksRelevant(t) || chosen.has(t.logicalName));

  return (
    <section className="panel">
      <h2>Import from Dataverse</h2>
      <p className="muted">
        Connect your Dataverse environment to bring in trips, destinations, places, activities and items. First step:
        pick the tables your app uses so the importer can be matched to them.
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
                <button className="btn btn-secondary" disabled={!!busy} onClick={loadTables}>
                  {tables ? 'Reload tables' : 'Show my tables'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={async () => {
                    await run('Signing out…', () => signOut(config));
                    setAccount(null);
                    setTables(null);
                    setSummary('');
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
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {tables && !summary && (
        <div className="dv-tables">
          <p className="small">
            {tables.length
              ? 'Tick the tables that hold your trips, destinations, places, activities and items (and any table linking items to activities):'
              : 'No custom tables found in this environment.'}
          </p>
          <ul className="dv-table-list">
            {visible.map((t) => (
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
          {tables.length > visible.length && (
            <button className="link-btn small" onClick={() => setShowAll(true)}>
              Show all {tables.length} custom tables
            </button>
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
    </section>
  );
}
