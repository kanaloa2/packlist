import { useSyncStatus, sync } from '../sync';

/** Small status pill in the top bar: synced / syncing / offline / problem. */
export function SyncIndicator() {
  const s = useSyncStatus();
  let label: string;
  let cls: string;
  let title: string;
  if (s.state === 'syncing') {
    label = 'Syncing…';
    cls = 'sync-busy';
    title = 'Saving your changes to your account';
  } else if (s.state === 'offline') {
    label = s.pending ? `Offline · ${s.pending}` : 'Offline';
    cls = 'sync-offline';
    title = s.pending
      ? `${s.pending} change${s.pending === 1 ? '' : 's'} saved on this device; they’ll sync when you’re back online`
      : 'You’re offline. Changes are saved on this device and will sync later.';
  } else if (s.state === 'error' || s.rejected) {
    label = 'Sync issue';
    cls = 'sync-error';
    title = s.message ?? `${s.rejected} change(s) were rejected by the server`;
  } else if (s.pending) {
    label = `${s.pending} pending`;
    cls = 'sync-busy';
    title = 'Changes waiting to sync';
  } else {
    label = 'Synced';
    cls = 'sync-ok';
    title = s.lastSyncedAt ? `Last synced ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : 'All changes saved';
  }
  return (
    <button className={`sync-pill ${cls}`} title={title} aria-label={`Sync status: ${title}`} onClick={() => sync.syncNow()}>
      <span className="sync-dot" aria-hidden />
      {label}
    </button>
  );
}
