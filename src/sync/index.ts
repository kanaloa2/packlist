import { useSyncExternalStore } from 'react';
import { db, ALL_TABLES } from '../db';
import { supabase } from '../supabase';
import { SyncEngine } from './engine';

export const sync = new SyncEngine(db, supabase);

export function useSyncStatus() {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}

const OWNER_KEY = 'owner';

export async function localOwner(): Promise<string | undefined> {
  return (await db.meta.get(OWNER_KEY))?.value;
}

export async function setLocalOwner(userId: string) {
  await db.meta.put({ key: OWNER_KEY, value: userId });
}

export async function localTripCount() {
  return db.trips.count();
}

export async function hasLocalData() {
  for (const t of ALL_TABLES) if ((await db.table(t).count()) > 0) return true;
  return false;
}

/** Wipes this device's copy (never touches the server). */
export async function clearLocalData() {
  await sync.silently(async () => {
    for (const t of ALL_TABLES) await db.table(t).clear();
  });
  await db.transaction('rw', [db.outbox, db.photoCache, db.meta], async () => {
    await db.outbox.clear();
    await db.photoCache.clear();
    await db.meta.clear();
  });
}
