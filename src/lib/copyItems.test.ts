import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';

async function tripWithActivity(name: string, start: string) {
  const trip = await repo.createTrip({ name, startDate: start, endDate: start });
  const d = await repo.createDestination(trip.id, { name: `${name} city` });
  const p = await repo.createPlace(d.id, { name: `${name} hotel`, type: 'Hotel' });
  const act = await repo.createActivity(p.id, { name: `${name} dinner`, start: `${start}T19:00`, end: `${start}T21:00` });
  return { trip, act };
}

describe('copying items', () => {
  it('copies chosen items to an activity on another trip, with quantity and note, attached to that trip', async () => {
    const vegas = await tripWithActivity('Vegas', '2027-03-10');
    const nyc = await tripWithActivity('NYC', '2027-04-10');
    const blazer = await repo.createItem({ name: 'Blazer', category: 'Clothing' });
    const shoes = await repo.createItem({ name: 'Shoes', category: 'Shoes' });
    const watch = await repo.createItem({ name: 'Watch', category: 'Accessories' });
    const l1 = await repo.addItemToActivity(vegas.act.id, blazer.id, 1);
    await repo.updateActivityItem(l1.id, { note: 'navy one' });
    await repo.addItemToActivity(vegas.act.id, shoes.id, 2);
    await repo.addItemToActivity(vegas.act.id, watch.id);

    const source = await db.activityItems.where('activityId').equals(vegas.act.id).toArray();
    const picked = source.filter((l) => l.itemId !== watch.id); // user unticked the watch
    expect(await repo.copyItemLinks(picked, { kind: 'activity', id: nyc.act.id })).toBe(2);

    const copied = await db.activityItems.where('activityId').equals(nyc.act.id).toArray();
    expect(copied.map((l) => [l.itemId, l.quantity, l.note, l.tripId]).sort()).toEqual(
      [
        [blazer.id, 1, 'navy one', nyc.trip.id],
        [shoes.id, 2, '', nyc.trip.id],
      ].sort(),
    );
    expect(await db.items.count()).toBe(3); // library items are shared, not duplicated
    // Copying again adds nothing; the source is untouched.
    expect(await repo.copyItemLinks(picked, { kind: 'activity', id: nyc.act.id })).toBe(0);
    expect(await db.activityItems.where('activityId').equals(vegas.act.id).count()).toBe(3);
  });

  it('copies to and from a trip’s whole-trip items', async () => {
    const vegas = await tripWithActivity('Vegas', '2027-03-10');
    const nyc = await tripWithActivity('NYC', '2027-04-10');
    const passport = await repo.createItem({ name: 'Passport', category: 'Documents' });
    await repo.addItemToTrip(vegas.trip.id, passport.id);
    const wholeTrip = await db.tripItems.where('tripId').equals(vegas.trip.id).toArray();
    expect(await repo.copyItemLinks(wholeTrip, { kind: 'trip', id: nyc.trip.id })).toBe(1);
    expect(await db.tripItems.where('tripId').equals(nyc.trip.id).count()).toBe(1);
    expect(await repo.copyItemLinks(wholeTrip, { kind: 'activity', id: nyc.act.id })).toBe(1);
    expect((await db.activityItems.where('activityId').equals(nyc.act.id).first())?.tripId).toBe(nyc.trip.id);
  });

  it('ignores duplicate picks and rejects missing targets', async () => {
    const vegas = await tripWithActivity('Vegas', '2027-03-10');
    const hat = await repo.createItem({ name: 'Hat', category: 'Accessories' });
    const link = { itemId: hat.id, quantity: 1, note: '' };
    expect(await repo.copyItemLinks([link, link], { kind: 'activity', id: vegas.act.id })).toBe(1);
    await expect(repo.copyItemLinks([link], { kind: 'activity', id: 'nope' })).rejects.toThrow(/not found/);
  });
});
