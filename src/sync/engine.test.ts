import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db';
import * as repo from '../lib/repo';
import { SyncEngine } from './engine';
import { FakeSupabase } from '../test/fakeSupabase';

let server: FakeSupabase;
let client: { current: FakeSupabase };
// One engine for the shared db (hooks are installed once); the server is swapped per test.
const proxy = new Proxy({} as SupabaseClient, {
  get: (_t, prop) => {
    const v = (client.current as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client.current) : v;
  },
});
client = { current: new FakeSupabase() };
const engine = new SyncEngine(db, proxy, { realtime: false, timers: false, pushDelayMs: 60_000, pullDelayMs: 60_000 });

/** Wait for queued outbox writes (they land on transaction complete). */
const settle = () => new Promise((r) => setTimeout(r, 20));

async function seed() {
  const trip = await repo.createTrip({ name: 'Vegas', startDate: '2027-03-10', endDate: '2027-03-14' });
  const dest = await repo.createDestination(trip.id, { name: 'Las Vegas' });
  const place = await repo.createPlace(dest.id, { name: 'Bellagio', type: 'Hotel' });
  const act = await repo.createActivity(place.id, { name: 'Check in', start: '2027-03-10T15:00', end: '2027-03-10T16:00' });
  const item = await repo.createItem({ name: 'Passport', category: 'Documents' });
  await repo.addItemToActivity(act.id, item.id);
  await repo.setPacked(trip.id, item.id, true);
  await settle();
  return { trip, dest, place, act, item };
}

beforeEach(async () => {
  server = new FakeSupabase();
  client.current = server;
  await engine.start('u1');
});

afterEach(async () => {
  await engine.stop();
});

describe('sync engine', () => {
  it('pushes local changes to the server in dependency order', async () => {
    const { trip, act } = await seed();
    expect(await db.outbox.count()).toBeGreaterThan(0);
    await engine.syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect(server.rows('trips')).toHaveLength(1);
    expect(server.table('trips').get(trip.id)).toMatchObject({ name: 'Vegas', start_date: '2027-03-10', end_date: '2027-03-14' });
    expect(server.table('activities').get(act.id)).toMatchObject({ start: '2027-03-10T15:00', place_id: act.placeId });
    expect(server.rows('activity_items')).toHaveLength(1);
    expect(server.rows('pack_status')[0]).toMatchObject({ packed: true });
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, rejected: 0 });
  });

  it('propagates updates and cascading deletes', async () => {
    const { trip, item } = await seed();
    await engine.syncNow();
    await repo.updateItem(item.id, { name: 'Passport + visa', category: 'Documents' });
    await repo.deleteTrip(trip.id);
    await settle();
    await engine.syncNow();
    expect(server.rows('trips')).toHaveLength(0);
    expect(server.rows('activities')).toHaveLength(0);
    expect(server.rows('pack_status')).toHaveLength(0);
    expect(server.table('items').get(item.id)).toMatchObject({ name: 'Passport + visa' });
  });

  it('pulls changes made on another device without re-queuing them', async () => {
    const { trip } = await seed();
    await engine.syncNow();
    // Another device renames the trip and adds a new item, and removes the destination.
    server.table('trips').set(trip.id, { ...server.table('trips').get(trip.id)!, name: 'Vegas baby' });
    server.table('items').set('11111111-1111-4111-8111-111111111111', {
      id: '11111111-1111-4111-8111-111111111111', name: 'Hat', category: 'Accessories', description: null, photo: null, created_at: 1, updated_at: 1,
    });
    for (const d of server.rows('destinations')) server.from('destinations').delete().in('id', [String(d.id)]);
    await engine.syncNow();
    expect((await db.trips.get(trip.id))?.name).toBe('Vegas baby');
    expect((await db.items.get('11111111-1111-4111-8111-111111111111'))?.description).toBe('');
    expect(await db.destinations.count()).toBe(0);
    expect(await db.activities.count()).toBe(0); // cascaded on the server, mirrored locally
    await settle();
    expect(await db.outbox.count()).toBe(0); // applying server data is not a local change
  });

  it('keeps offline changes and never lets a pull overwrite them', async () => {
    const { trip } = await seed();
    await engine.syncNow();
    server.offline = true;
    await repo.updateTrip(trip.id, { name: 'Renamed offline', startDate: '2027-03-10', endDate: '2027-03-14' });
    await settle();
    await engine.syncNow();
    expect(engine.getStatus().state).toBe('offline');
    expect(engine.getStatus().pending).toBe(1);
    // Meanwhile the server copy changed elsewhere.
    server.table('trips').get(trip.id)!.name = 'Changed elsewhere';
    server.offline = false;
    await engine.syncNow();
    expect((await db.trips.get(trip.id))?.name).toBe('Renamed offline');
    expect(server.table('trips').get(trip.id)?.name).toBe('Renamed offline');
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('drops changes the server rejects without blocking the rest', async () => {
    const { trip, dest } = await seed();
    await engine.syncNow();
    // The trip is deleted on another device, but this device adds a place under it first.
    server.from('trips').delete().in('id', [trip.id]);
    await repo.createPlace(dest.id, { name: 'Pool', type: 'Pool / Beach' });
    const hat = await repo.createItem({ name: 'Hat', category: 'Accessories' });
    await settle();
    await engine.syncNow();
    expect(engine.getStatus().rejected).toBe(1);
    expect(server.table('items').has(hat.id)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    // And the device now matches the server: the deleted trip is gone locally too.
    expect(await db.trips.count()).toBe(0);
  });

  it('uploads photos once by content and restores them on a fresh device', async () => {
    const photo = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes');
    const trip = await repo.createTrip({ name: 'Photo trip', startDate: '2027-01-01', endDate: '2027-01-02', photo });
    const item = await repo.createItem({ name: 'Same photo', category: 'Gear', photo });
    await settle();
    await engine.syncNow();
    const path = server.table('trips').get(trip.id)?.photo as string;
    expect(path).toMatch(/^u1\/[0-9a-f]{64}\.jpg$/);
    expect(server.table('items').get(item.id)?.photo).toBe(path);
    expect(server.files.size).toBe(1);

    // Fresh device: empty local copy, same account.
    await engine.stop();
    await engine.silently(async () => {
      await db.trips.clear();
      await db.items.clear();
    });
    await db.photoCache.clear();
    await engine.start('u1');
    expect((await db.trips.get(trip.id))?.photo).toBe(photo);
  });

  it('removing a photo clears it on the server', async () => {
    const photo = 'data:image/jpeg;base64,' + btoa('x');
    const trip = await repo.createTrip({ name: 'T', startDate: '2027-01-01', endDate: '2027-01-02', photo });
    await settle();
    await engine.syncNow();
    await repo.updateTrip(trip.id, { name: 'T', startDate: '2027-01-01', endDate: '2027-01-02', photo: undefined });
    await settle();
    await engine.syncNow();
    expect(server.table('trips').get(trip.id)?.photo).toBeNull();
    expect((await db.trips.get(trip.id))?.photo).toBeUndefined();
  });

  it('syncs per-trip counts and count rules, and keeps them when ticking packed', async () => {
    const { trip, item } = await seed();
    await repo.updateItem(item.id, { name: 'Socks', category: 'Clothing', countRule: 'perDay' });
    await repo.setPackQuantity(trip.id, item.id, 4);
    await repo.setPacked(trip.id, item.id, false);
    await settle();
    await engine.syncNow();
    expect(server.table('items').get(item.id)).toMatchObject({ count_rule: 'perDay' });
    expect(server.table('pack_status').get(`${trip.id}:${item.id}`)).toMatchObject({ quantity: 4, packed: false });
    // Another device resets it to automatic.
    server.table('pack_status').get(`${trip.id}:${item.id}`)!.quantity = null;
    await engine.syncNow();
    expect((await db.packStatus.get(`${trip.id}:${item.id}`))?.quantity).toBeNull();
  });

  it('does not record changes while signed out', async () => {
    await engine.stop();
    await repo.createItem({ name: 'Local only', category: 'Other' });
    await settle();
    expect(await db.outbox.count()).toBe(0);
  });
});
