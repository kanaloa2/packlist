import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Transaction } from 'dexie';
import { ALL_TABLES, type OutboxEntry, type PacklistDB, type TableName } from '../db';
import { COLUMNS, HAS_PHOTO, REMOTE_TABLE, fromRemote, toRemote } from './mapping';

/**
 * Offline-first sync between the local IndexedDB copy and Supabase.
 *
 * - Every local write is captured by Dexie hooks and recorded in `outbox` as (table, key).
 * - push() sends the *current* local state of each queued row in queue order (parents are
 *   always queued before children), as an upsert if the row exists or a delete if it doesn't.
 * - pull() fetches everything the user owns and makes the local copy match, but only when
 *   nothing is waiting to be pushed, so it can never overwrite an unsynced local change.
 * - Photos are stored in the private `photos` bucket at `<uid>/<sha256>.jpg`; the database row
 *   holds that path, the local row holds the image itself.
 */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Local changes not yet on the server. */
  pending: number;
  /** Changes the server rejected (e.g. the parent was deleted on another device). */
  rejected: number;
  lastSyncedAt?: number;
  message?: string;
}

type Row = Record<string, unknown>;

interface DbError {
  message: string;
  code?: string;
  status?: number;
}

class TransientError extends Error {}

const PAGE = 1000;

export class SyncEngine {
  private userId: string | null = null;
  /** Transactions that are applying server data; their writes must not be queued. */
  private remoteTx = new WeakSet<Transaction>();
  private pendingByTx = new WeakMap<Transaction, OutboxEntry[]>();
  private running: Promise<void> | null = null;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<() => void>();
  private status: SyncStatus = { state: 'idle', pending: 0, rejected: 0 };
  private cleanup: (() => void)[] = [];

  constructor(
    private db: PacklistDB,
    private client: SupabaseClient,
    private opts: { pushDelayMs?: number; pullDelayMs?: number; realtime?: boolean; timers?: boolean } = {},
  ) {
    this.installHooks();
  }

  // ---------- status ----------

  getStatus = () => this.status;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  private async refreshPending() {
    this.setStatus({ pending: await this.db.outbox.count() });
  }

  // ---------- lifecycle ----------

  get currentUser() {
    return this.userId;
  }

  /** Start syncing for a signed-in user. Local writes are recorded from now on. */
  start(userId: string) {
    this.userId = userId;
    const { realtime = true, timers = true } = this.opts;
    if (timers && typeof window !== 'undefined') {
      const onOnline = () => this.syncNow();
      const onVisible = () => document.visibilityState === 'visible' && this.syncNow();
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisible);
      this.interval = setInterval(() => document.visibilityState === 'visible' && this.syncNow(), 60_000);
      this.cleanup.push(() => {
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisible);
      });
    }
    if (realtime) this.subscribeRealtime(userId);
    void this.refreshPending();
    return this.syncNow();
  }

  async stop() {
    this.userId = null;
    for (const c of this.cleanup.splice(0)) c();
    if (this.interval) clearInterval(this.interval);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.pullTimer) clearTimeout(this.pullTimer);
    this.interval = this.pushTimer = this.pullTimer = null;
    if (this.channel) {
      await this.client.removeChannel(this.channel);
      this.channel = null;
    }
    await this.running?.catch(() => {});
    this.setStatus({ state: 'idle', pending: 0, rejected: 0, lastSyncedAt: undefined, message: undefined });
  }

  private subscribeRealtime(userId: string) {
    let ch = this.client.channel(`packlist-${userId}`);
    for (const t of ALL_TABLES) {
      for (const event of ['INSERT', 'UPDATE'] as const) {
        ch = ch.on(
          'postgres_changes',
          { event, schema: 'public', table: REMOTE_TABLE[t], filter: `user_id=eq.${userId}` },
          () => this.schedulePull(),
        );
      }
      // Supabase can't filter DELETE events (they carry only the primary key), so listen
      // unfiltered and pull only if the deleted row is one this device actually has.
      ch = ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: REMOTE_TABLE[t] }, (payload) => {
        const id = (payload.old as Row | undefined)?.id;
        if (id === undefined) return this.schedulePull();
        void this.db
          .table(t)
          .get(String(id))
          .then((row) => row && this.schedulePull());
      });
    }
    this.channel = ch.subscribe();
  }

  // ---------- capturing local changes ----------

  private installHooks() {
    for (const t of ALL_TABLES) {
      const table = this.db.table(t);
      const record = (key: unknown, trans: Transaction) => {
        if (!this.userId || this.remoteTx.has(trans) || key === undefined) return;
        let buf = this.pendingByTx.get(trans);
        if (!buf) {
          buf = [];
          this.pendingByTx.set(trans, buf);
          // Persist the queue only once the change itself has committed.
          trans.on('complete', () => {
            void this.db.outbox.bulkAdd(buf!).then(() => {
              void this.refreshPending();
              this.schedulePush();
            });
          });
        }
        buf.push({ table: t, key: String(key) });
      };
      table.hook('creating', (pk, obj, trans) => record(pk ?? (obj as Row).id, trans));
      table.hook('updating', (_mods, pk, _obj, trans) => record(pk, trans));
      table.hook('deleting', (pk, _obj, trans) => record(pk, trans));
    }
  }

  /** Runs fn in a transaction whose writes are NOT sent to the server. */
  async silently<T>(fn: () => Promise<T>, tables: string[] = [...ALL_TABLES]): Promise<T> {
    return this.db.transaction('rw', tables, async (tx) => {
      this.remoteTx.add(tx);
      return fn();
    });
  }

  /** Queues every local row for upload (used when claiming pre-account data). */
  async enqueueAll() {
    const entries: OutboxEntry[] = [];
    for (const t of ALL_TABLES) {
      for (const key of await this.db.table(t).toCollection().primaryKeys()) entries.push({ table: t, key: String(key) });
    }
    await this.db.outbox.bulkAdd(entries);
    await this.refreshPending();
  }

  // ---------- scheduling ----------

  schedulePush() {
    if (!this.userId) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.run(false), this.opts.pushDelayMs ?? 300);
  }

  schedulePull() {
    if (!this.userId) return;
    if (this.pullTimer) clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => void this.run(true), this.opts.pullDelayMs ?? 500);
  }

  /** Push pending changes, then pull the latest from the server. */
  syncNow() {
    return this.run(true);
  }

  private run(pull: boolean): Promise<void> {
    if (this.running) {
      this.again = this.again || pull;
      return this.running;
    }
    this.running = (async () => {
      let doPull = pull;
      do {
        this.again = false;
        await this.cycle(doPull);
        doPull = this.again || doPull;
      } while (this.again && this.userId);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(pull: boolean) {
    if (!this.userId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.refreshPending();
      this.setStatus({ state: 'offline', message: undefined });
      return;
    }
    this.setStatus({ state: 'syncing' });
    try {
      await this.push();
      if (pull) await this.pull();
      await this.refreshPending();
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now(), message: undefined });
    } catch (e) {
      await this.refreshPending();
      const offline = e instanceof TransientError || (typeof navigator !== 'undefined' && navigator.onLine === false);
      this.setStatus({ state: offline ? 'offline' : 'error', message: (e as Error).message });
    }
  }

  // ---------- push ----------

  async push(): Promise<void> {
    const uid = this.userId;
    if (!uid) return;
    const entries = await this.db.outbox.orderBy('seq').toArray();
    if (!entries.length) return;

    // One operation per row, at the position it was first queued.
    const order: { table: TableName; key: string; seqs: number[] }[] = [];
    const byKey = new Map<string, (typeof order)[number]>();
    for (const e of entries) {
      const id = `${e.table}\u0000${e.key}`;
      const existing = byKey.get(id);
      if (existing) existing.seqs.push(e.seq!);
      else {
        const op = { table: e.table, key: e.key, seqs: [e.seq!] };
        byKey.set(id, op);
        order.push(op);
      }
    }

    // Read current local state for every queued row.
    const current = new Map<string, Row | undefined>();
    for (const t of ALL_TABLES) {
      const keys = order.filter((o) => o.table === t).map((o) => o.key);
      if (!keys.length) continue;
      const rows = await this.db.table(t).bulkGet(keys);
      keys.forEach((k, i) => current.set(`${t}\u0000${k}`, rows[i] as Row | undefined));
    }

    // Group consecutive operations of the same kind on the same table.
    type Group = { table: TableName; kind: 'upsert' | 'delete'; ops: typeof order };
    const groups: Group[] = [];
    for (const o of order) {
      const kind = current.get(`${o.table}\u0000${o.key}`) ? 'upsert' : 'delete';
      const last = groups[groups.length - 1];
      if (last && last.table === o.table && last.kind === kind && last.ops.length < 500) last.ops.push(o);
      else groups.push({ table: o.table, kind, ops: [o] });
    }

    for (const g of groups) {
      const rows = g.ops.map((o) => current.get(`${o.table}\u0000${o.key}`)!);
      const rejected = await this.sendGroup(g.table, g.kind, g.ops.map((o) => o.key), rows, uid);
      if (rejected) this.setStatus({ rejected: this.status.rejected + rejected });
      await this.db.outbox.bulkDelete(g.ops.flatMap((o) => o.seqs));
    }
  }

  /** Sends one group; returns how many rows the server permanently rejected. Throws on transient failure. */
  private async sendGroup(table: TableName, kind: 'upsert' | 'delete', keys: string[], rows: Row[], uid: string): Promise<number> {
    const remote = REMOTE_TABLE[table];
    if (kind === 'delete') {
      const { error, status } = await this.client.from(remote).delete().in('id', keys);
      if (error) {
        if (isPermanent(error, status)) return keys.length;
        throw new TransientError(error.message);
      }
      return 0;
    }
    const payload = [];
    for (const r of rows) payload.push(await this.toRemoteWithPhoto(table, r, uid));
    const { error, status } = await this.client.from(remote).upsert(payload);
    if (!error) return 0;
    if (!isPermanent(error, status)) throw new TransientError(error.message);
    if (payload.length === 1) {
      console.warn(`Packlist: server rejected ${table} ${keys[0]}:`, error.message);
      return 1;
    }
    // Find the bad row(s): send individually, keep the good ones.
    let rejected = 0;
    for (let i = 0; i < payload.length; i++) {
      const one = await this.client.from(remote).upsert([payload[i]]);
      if (one.error) {
        if (!isPermanent(one.error, one.status)) throw new TransientError(one.error.message);
        console.warn(`Packlist: server rejected ${table} ${keys[i]}:`, one.error.message);
        rejected++;
      }
    }
    return rejected;
  }

  private async toRemoteWithPhoto(table: TableName, row: Row, uid: string): Promise<Row> {
    const out = toRemote(table, row);
    if (HAS_PHOTO[table] && typeof row.photo === 'string' && row.photo.startsWith('data:')) {
      out.photo = await this.uploadPhoto(row.photo, uid);
    }
    return out;
  }

  private async uploadPhoto(dataUrl: string, uid: string): Promise<string> {
    const path = `${uid}/${await sha256Hex(dataUrl)}.jpg`;
    if (await this.db.photoCache.get(path)) return path; // already uploaded (or downloaded)
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await this.client.storage.from('photos').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '31536000',
    });
    if (error) throw new TransientError(`Photo upload failed: ${error.message}`);
    await this.db.photoCache.put({ path, dataUrl });
    return path;
  }

  // ---------- pull ----------

  async pull(): Promise<void> {
    if (!this.userId) return;
    if ((await this.db.outbox.count()) > 0) return; // push first; pull next time

    const remote = {} as Record<TableName, Row[]>;
    for (const t of ALL_TABLES) remote[t] = await this.fetchAll(t);

    // Resolve photo paths to images (downloading only ones we don't have yet).
    for (const t of ALL_TABLES) {
      if (!HAS_PHOTO[t]) continue;
      for (const r of remote[t]) {
        if (typeof r.photo === 'string' && r.photo && !r.photo.startsWith('data:')) {
          r.photo = (await this.resolvePhoto(r.photo)) ?? undefined;
          if (r.photo === undefined) delete r.photo;
        }
      }
    }

    await this.db.transaction('rw', [...ALL_TABLES, 'outbox'], async (tx) => {
      this.remoteTx.add(tx);
      // A local change landed while we were fetching: keep it, try again after pushing.
      if ((await this.db.outbox.count()) > 0) {
        this.again = true;
        return;
      }
      for (const t of ALL_TABLES) {
        const table = this.db.table(t);
        const local = (await table.toArray()) as Row[];
        const localById = new Map(local.map((r) => [String(r.id), r]));
        const remoteIds = new Set(remote[t].map((r) => String(r.id)));
        const gone = local.filter((r) => !remoteIds.has(String(r.id))).map((r) => r.id);
        if (gone.length) await table.bulkDelete(gone as string[]);
        const changed = remote[t].filter((r) => !sameRow(t, localById.get(String(r.id)), r));
        if (changed.length) await table.bulkPut(changed);
      }
    });
  }

  private async fetchAll(t: TableName): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from(REMOTE_TABLE[t])
        .select('*')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new TransientError(error.message);
      for (const r of data ?? []) out.push(fromRemote(t, r as Row));
      if (!data || data.length < PAGE) return out;
    }
  }

  private async resolvePhoto(path: string): Promise<string | null> {
    const cached = await this.db.photoCache.get(path);
    if (cached) return cached.dataUrl;
    const { data, error } = await this.client.storage.from('photos').download(path);
    if (error || !data) return null;
    const dataUrl = await blobToDataUrl(data);
    await this.db.photoCache.put({ path, dataUrl });
    return dataUrl;
  }
}

function isPermanent(error: DbError, status?: number): boolean {
  const code = error.code ?? '';
  if (/^(22|23|42|P0)/.test(code)) return true; // data, constraint, permission/RLS errors
  if (status && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) return true;
  return false;
}

function sameRow(t: TableName, a: Row | undefined, b: Row): boolean {
  if (!a) return false;
  return COLUMNS[t].every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}
