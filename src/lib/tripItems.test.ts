import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';
import { buildPackingList, groupPackingList, packingListToText, WHOLE_TRIP } from './packing';

async function load(tripId: string) {
  const trip = (await db.trips.get(tripId))!;
  const [destinations, places, activities, activityItems, tripItems, packStatus, items] = await Promise.all([
    db.destinations.where('tripId').equals(tripId).toArray(),
    db.places.where('tripId').equals(tripId).toArray(),
    db.activities.where('tripId').equals(tripId).toArray(),
    db.activityItems.where('tripId').equals(tripId).toArray(),
    db.tripItems.where('tripId').equals(tripId).toArray(),
    db.packStatus.where('tripId').equals(tripId).toArray(),
    db.items.toArray(),
  ]);
  return { trip, destinations, places, activities, activityItems, tripItems, packStatus, items };
}

async function setup() {
  const trip = await repo.createTrip({ name: 'Vegas', startDate: '2027-03-10', endDate: '2027-03-13' });
  const d = await repo.createDestination(trip.id, { name: 'Las Vegas' });
  const p = await repo.createPlace(d.id, { name: 'Bellagio', type: 'Hotel' });
  const dinner = await repo.createActivity(p.id, { name: 'Dinner', start: '2027-03-11T19:00', end: '2027-03-11T21:00' });
  const passport = await repo.createItem({ name: 'Passport', category: 'Documents' });
  const charger = await repo.createItem({ name: 'Charger', category: 'Electronics' });
  const socks = await repo.createItem({ name: 'Socks', category: 'Clothing', countRule: 'perDay' });
  const blazer = await repo.createItem({ name: 'Blazer', category: 'Clothing', countRule: 'perActivity' });
  return { trip, dinner, passport, charger, socks, blazer };
}

describe('whole-trip items', () => {
  it('appear on the packing list without any activity, tagged as whole trip', async () => {
    const { trip, passport } = await setup();
    await repo.addItemToTrip(trip.id, passport.id);
    await repo.addItemToTrip(trip.id, passport.id); // no duplicate
    expect(await db.tripItems.count()).toBe(1);
    const [e] = buildPackingList(await load(trip.id));
    expect(e).toMatchObject({ quantity: 1, reason: 'Added to the whole trip', usages: [] });
    expect(e.item.name).toBe('Passport');
    expect(e.tripLevel).toBeDefined();
  });

  it('count like one more activity: per day scales, per activity adds, whole-trip rule takes the most', async () => {
    const { trip, dinner, socks, blazer, charger } = await setup();
    await repo.addItemToTrip(trip.id, socks.id);
    await repo.addItemToActivity(dinner.id, blazer.id);
    await repo.addItemToTrip(trip.id, blazer.id);
    await repo.addItemToActivity(dinner.id, charger.id, 1);
    await repo.addItemToTrip(trip.id, charger.id, 2);
    const byName = Object.fromEntries(buildPackingList(await load(trip.id)).map((e) => [e.item.name, e]));
    expect(byName.Socks.quantity).toBe(4); // 1 per day × 4 days
    expect(byName.Blazer).toMatchObject({ quantity: 2, reason: 'Total across 1 activity and the whole trip' });
    expect(byName.Charger.quantity).toBe(2);
  });

  it('get their own group in Day and Destination views, and show in the shared text', async () => {
    const { trip, dinner, passport, blazer } = await setup();
    await repo.addItemToTrip(trip.id, passport.id);
    await repo.addItemToActivity(dinner.id, blazer.id);
    const data = await load(trip.id);
    const entries = buildPackingList(data);
    const day = groupPackingList(entries, 'day');
    expect(day.map((g) => g.label)).toEqual([WHOLE_TRIP.label, 'First needed Thursday, March 11']);
    const dest = groupPackingList(entries, 'destination', data.destinations);
    expect(dest.map((g) => g.label)).toEqual([WHOLE_TRIP.label, 'Las Vegas']);
    expect(packingListToText('Vegas', groupPackingList(entries, 'category'))).toContain('☐ Passport — Whole trip');
  });

  it('are removed with their trip or item, and copied when a trip is duplicated', async () => {
    const { trip, passport, charger } = await setup();
    await repo.addItemToTrip(trip.id, passport.id);
    await repo.addItemToTrip(trip.id, charger.id);
    const copy = await repo.duplicateTrip(trip.id, 'Vegas again', '2027-05-01');
    expect(await db.tripItems.where('tripId').equals(copy.id).count()).toBe(2);
    await repo.deleteItem(charger.id);
    expect(await db.tripItems.where('itemId').equals(charger.id).count()).toBe(0);
    await repo.deleteTrip(trip.id);
    expect(await db.tripItems.where('tripId').equals(trip.id).count()).toBe(0);
    expect(await db.tripItems.count()).toBe(1); // the copy's passport
    await repo.removeItemFromTrip(copy.id, passport.id);
    expect(await db.tripItems.count()).toBe(0);
  });
});
