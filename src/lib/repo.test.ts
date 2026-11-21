import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';

async function setup() {
  const trip = await repo.createTrip({ name: 'Vegas', startDate: '2027-03-10', endDate: '2027-03-14' });
  const dest = await repo.createDestination(trip.id, { name: 'Las Vegas' });
  const place = await repo.createPlace(dest.id, { name: 'Bellagio', type: 'Hotel' });
  const act = await repo.createActivity(place.id, { name: 'Check in', start: '2027-03-10T15:00', end: '2027-03-10T16:00' });
  const item = await repo.createItem({ name: 'Passport', category: 'Documents' });
  await repo.addItemToActivity(act.id, item.id);
  return { trip, dest, place, act, item };
}

describe('repo', () => {
  it('denormalizes trip/destination ids down the hierarchy', async () => {
    const { trip, dest, act } = await setup();
    expect(act.tripId).toBe(trip.id);
    expect(act.destinationId).toBe(dest.id);
    const link = await db.activityItems.toCollection().first();
    expect(link?.tripId).toBe(trip.id);
  });

  it('requires names', async () => {
    await expect(repo.createTrip({ name: '  ', startDate: '2027-01-01', endDate: '2027-01-02' })).rejects.toThrow(
      repo.ValidationError,
    );
  });

  it('rejects activities outside the trip dates', async () => {
    const { place } = await setup();
    await expect(
      repo.createActivity(place.id, { name: 'Late', start: '2027-03-15T10:00', end: '2027-03-15T11:00' }),
    ).rejects.toThrow(/within the trip/);
  });

  it('blocks changing trip dates that would orphan activities', async () => {
    const { trip } = await setup();
    await expect(
      repo.updateTrip(trip.id, { name: 'Vegas', startDate: '2027-03-11', endDate: '2027-03-14' }),
    ).rejects.toThrow(/outside these dates/);
    await repo.updateTrip(trip.id, { name: 'Vegas', startDate: '2027-03-09', endDate: '2027-03-16' });
    expect((await db.trips.get(trip.id))?.startDate).toBe('2027-03-09');
  });

  it('does not add the same item twice to an activity', async () => {
    const { act, item } = await setup();
    await repo.addItemToActivity(act.id, item.id);
    expect(await db.activityItems.count()).toBe(1);
  });

  it('cascades trip deletion but keeps library items', async () => {
    const { trip, item } = await setup();
    await repo.setPacked(trip.id, item.id, true);
    await repo.deleteTrip(trip.id);
    expect(await db.destinations.count()).toBe(0);
    expect(await db.places.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    expect(await db.activityItems.count()).toBe(0);
    expect(await db.packStatus.count()).toBe(0);
    expect(await db.items.count()).toBe(1);
  });

  it('cascades destination and place deletion', async () => {
    const { dest } = await setup();
    await repo.deleteDestination(dest.id);
    expect(await db.places.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    expect(await db.activityItems.count()).toBe(0);
    expect(await db.trips.count()).toBe(1);
  });

  it('removes an item from all activities when deleted', async () => {
    const { item, trip } = await setup();
    await repo.setPacked(trip.id, item.id, true);
    await repo.deleteItem(item.id);
    expect(await db.activityItems.count()).toBe(0);
    expect(await db.packStatus.count()).toBe(0);
  });

  it('copies items between activities without duplicates', async () => {
    const { place, act, item } = await setup();
    const other = await repo.createActivity(place.id, { name: 'Pool', start: '2027-03-11T10:00', end: '2027-03-11T12:00' });
    const towel = await repo.createItem({ name: 'Towel', category: 'Gear' });
    await repo.addItemToActivity(other.id, towel.id);
    await repo.addItemToActivity(other.id, item.id);
    expect(await repo.copyActivityItems(other.id, act.id)).toBe(1);
    expect(await db.activityItems.where('activityId').equals(act.id).count()).toBe(2);
  });

  it('duplicates a trip shifted to a new start date', async () => {
    const { trip } = await setup();
    const copy = await repo.duplicateTrip(trip.id, 'Vegas again', '2027-04-01');
    expect(copy.startDate).toBe('2027-04-01');
    expect(copy.endDate).toBe('2027-04-05');
    const acts = await db.activities.where('tripId').equals(copy.id).toArray();
    expect(acts).toHaveLength(1);
    expect(acts[0].start).toBe('2027-04-01T15:00');
    expect(await db.activityItems.where('tripId').equals(copy.id).count()).toBe(1);
    expect(await db.items.count()).toBe(1); // items are shared, not copied
  });
});

describe('count rule defaults', () => {
  it('suggests one-per-day for socks and underwear', async () => {
    const { defaultCountRule } = await import('../components/forms');
    expect(defaultCountRule('Socks', 'Clothing')).toBe('perDay');
    expect(defaultCountRule('Underwear', 'Clothing')).toBe('perDay');
    expect(defaultCountRule('Navy blazer', 'Clothing')).toBe('trip');
    expect(defaultCountRule('Daily vitamins', 'Medications')).toBe('perDay');
  });
});
