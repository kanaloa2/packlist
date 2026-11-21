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
