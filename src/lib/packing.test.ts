import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';
import { buildPackingList, groupPackingList, packingListToText, packingProgress } from './packing';

async function load(tripId: string) {
  const [destinations, places, activities, activityItems, packStatus, items] = await Promise.all([
    db.destinations.where('tripId').equals(tripId).toArray(),
    db.places.where('tripId').equals(tripId).toArray(),
    db.activities.where('tripId').equals(tripId).toArray(),
    db.activityItems.where('tripId').equals(tripId).toArray(),
    db.packStatus.where('tripId').equals(tripId).toArray(),
    db.items.toArray(),
  ]);
  return { destinations, places, activities, activityItems, packStatus, items };
}

describe('packing list', () => {
  it('aggregates items across activities, grouped and sorted', async () => {
    const trip = await repo.createTrip({ name: 'T', startDate: '2027-03-10', endDate: '2027-03-14' });
    const vegas = await repo.createDestination(trip.id, { name: 'Las Vegas' });
    const ny = await repo.createDestination(trip.id, { name: 'New York' });
    const pool = await repo.createPlace(vegas.id, { name: 'Pool', type: 'Pool / Beach' });
    const theater = await repo.createPlace(ny.id, { name: 'Theater', type: 'Venue' });
    const swim = await repo.createActivity(pool.id, { name: 'Pool time', start: '2027-03-11T10:00', end: '2027-03-11T14:00' });
    const show = await repo.createActivity(theater.id, { name: 'Show', start: '2027-03-13T19:00', end: '2027-03-13T22:00' });
    const dinner = await repo.createActivity(pool.id, { name: 'Poolside dinner', start: '2027-03-10T19:00', end: '2027-03-10T21:00' });

    const suit = await repo.createItem({ name: 'swimsuit', category: 'Swimwear' });
    const shoes = await repo.createItem({ name: 'Dress shoes', category: 'Shoes' });
    const blazer = await repo.createItem({ name: 'Blazer', category: 'Clothing' });
    await repo.addItemToActivity(swim.id, suit.id, 2);
    await repo.addItemToActivity(show.id, shoes.id);
    await repo.addItemToActivity(show.id, blazer.id);
    await repo.addItemToActivity(dinner.id, blazer.id);
    await repo.setPacked(trip.id, blazer.id, true);

    const entries = buildPackingList(await load(trip.id));
    expect(entries.map((e) => e.item.name)).toEqual(['Blazer', 'Dress shoes', 'swimsuit']);
    const blazerEntry = entries.find((e) => e.item.id === blazer.id)!;
    expect(blazerEntry.usages.map((u) => u.activity.name)).toEqual(['Poolside dinner', 'Show']);
    expect(blazerEntry.firstNeeded).toBe('2027-03-10T19:00');
    expect(blazerEntry.packed).toBe(true);
    expect(entries.find((e) => e.item.id === suit.id)!.quantity).toBe(2);

    expect(packingProgress(entries)).toEqual({ total: 3, packed: 1, percent: 33 });

    const byCat = groupPackingList(entries, 'category');
    expect(byCat.map((g) => g.key)).toEqual(['Clothing', 'Shoes', 'Swimwear']);

    const byDay = groupPackingList(entries, 'day');
    expect(byDay.map((g) => g.key)).toEqual(['2027-03-10', '2027-03-11', '2027-03-13']);

    const byDest = groupPackingList(entries, 'destination');
    expect(byDest.map((g) => g.label)).toEqual(['Las Vegas', 'New York']);
    // Blazer is needed in both destinations.
    expect(byDest[0].entries.map((e) => e.item.name)).toEqual(['Blazer', 'swimsuit']);
    expect(byDest[1].entries.map((e) => e.item.name)).toEqual(['Blazer', 'Dress shoes']);

    const text = packingListToText('T', byCat);
    expect(text).toContain('☑ Blazer');
    expect(text).toContain('☐ swimsuit ×2');
  });

  it('uses the largest single-activity quantity when an item is reused', async () => {
    const trip = await repo.createTrip({ name: 'T', startDate: '2027-03-10', endDate: '2027-03-14' });
    const d = await repo.createDestination(trip.id, { name: 'D' });
    const p = await repo.createPlace(d.id, { name: 'P', type: 'Other' });
    const a1 = await repo.createActivity(p.id, { name: 'A1', start: '2027-03-10T10:00', end: '2027-03-10T11:00' });
    const a2 = await repo.createActivity(p.id, { name: 'A2', start: '2027-03-11T10:00', end: '2027-03-11T11:00' });
    const socks = await repo.createItem({ name: 'Socks', category: 'Clothing' });
    await repo.addItemToActivity(a1.id, socks.id, 3);
    await repo.addItemToActivity(a2.id, socks.id, 1);
    const [entry] = buildPackingList(await load(trip.id));
    expect(entry.quantity).toBe(3);
  });
});

describe('per-trip counts', () => {
  async function setup(countRule: 'trip' | 'perDay' | 'perActivity', days = 5) {
    const end = `2027-03-${String(9 + days).padStart(2, '0')}`;
    const trip = await repo.createTrip({ name: 'T', startDate: '2027-03-10', endDate: end });
    const d = await repo.createDestination(trip.id, { name: 'D' });
    const p = await repo.createPlace(d.id, { name: 'P', type: 'Other' });
    const a1 = await repo.createActivity(p.id, { name: 'A1', start: '2027-03-10T10:00', end: '2027-03-10T11:00' });
    const a2 = await repo.createActivity(p.id, { name: 'A2', start: '2027-03-11T10:00', end: '2027-03-11T11:00' });
    const socks = await repo.createItem({ name: 'Socks', category: 'Clothing', countRule });
    await repo.addItemToActivity(a1.id, socks.id, 2);
    await repo.addItemToActivity(a2.id, socks.id, 1);
    const data = await load(trip.id);
    return { trip, socks, data: { ...data, trip } };
  }

  it('one per day scales with trip length', async () => {
    const { data } = await setup('perDay', 6);
    const [e] = buildPackingList(data);
    expect(e.quantity).toBe(12); // 2 per day (largest activity quantity) × 6 days
    expect(e.reason).toBe('2 per day × 6 days');
    expect(e.manual).toBe(false);
  });

  it('one per activity adds up activity quantities', async () => {
    const { data } = await setup('perActivity');
    expect(buildPackingList(data)[0].quantity).toBe(3);
  });

  it('whole-trip items use the largest single-activity quantity', async () => {
    const { data } = await setup('trip');
    expect(buildPackingList(data)[0].quantity).toBe(2);
  });

  it('a manual count overrides the automatic one for that trip only', async () => {
    const { trip, socks } = await setup('perDay', 5);
    const other = await setup('perDay', 3);
    await repo.setPackQuantity(trip.id, socks.id, 4);
    const [e] = buildPackingList({ ...(await load(trip.id)), trip });
    expect(e).toMatchObject({ quantity: 4, autoQuantity: 10, manual: true });
    // The same item on another trip keeps its own automatic count.
    expect(buildPackingList({ ...(await load(other.trip.id)), trip: other.trip })[0].quantity).toBe(6);
    // Ticking it packed keeps the manual count, and resetting goes back to automatic.
    await repo.setPacked(trip.id, socks.id, true);
    expect(buildPackingList({ ...(await load(trip.id)), trip })[0]).toMatchObject({ quantity: 4, packed: true });
    await repo.setPackQuantity(trip.id, socks.id, null);
    expect(buildPackingList({ ...(await load(trip.id)), trip })[0]).toMatchObject({ quantity: 10, manual: false, packed: true });
  });

  it('items created before count rules existed behave as whole-trip', async () => {
    const { data, socks } = await setup('trip');
    const legacy = data.items.map((i) => (i.id === socks.id ? { ...i, countRule: undefined } : i));
    expect(buildPackingList({ ...data, items: legacy })[0].quantity).toBe(2);
  });
});
