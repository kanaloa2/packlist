import { describe, expect, it } from 'vitest';
import { suggestKind, typeOptions, typeRank } from './itemTypes';
import { db } from '../db';
import * as repo from './repo';
import { buildPackingList, groupPackingList, packingListToText } from './packing';

describe('item types', () => {
  it('suggests a type from the item name', () => {
    expect(suggestKind('Navy blazer')).toBe('Jackets & coats');
    expect(suggestKind('White dress shirt')).toBe('Shirts');
    expect(suggestKind('Black jeans')).toBe('Pants');
    expect(suggestKind('Dress shoes')).toBe('Shoes');
    expect(suggestKind('Board shorts')).toBe('Swimwear');
    expect(suggestKind('Sunglasses')).toBe('Accessories');
    expect(suggestKind('Phone charger')).toBe('');
  });

  it('offers suggested types plus the user’s own, without duplicates', () => {
    const opts = typeOptions([{ kind: 'Workout gear' }, { kind: 'shirts' }, { kind: '' }, { kind: 'Workout gear' }, {}]);
    expect(opts.slice(0, 2)).toEqual(['Shirts', 'Pants']);
    expect(opts.filter((o) => o.toLowerCase() === 'shirts')).toHaveLength(1);
    expect(opts.at(-1)).toBe('Workout gear');
  });

  it('orders suggested types, then custom types, then category fallbacks', () => {
    const labels = ['Toiletries', 'Workout gear', 'Shoes', 'Shirts', 'Archery'];
    const sorted = [...labels].sort((a, b) => {
      const [ra, na] = typeRank(a);
      const [rb, nb] = typeRank(b);
      return ra - rb || na.localeCompare(nb);
    });
    expect(sorted).toEqual(['Shirts', 'Shoes', 'Archery', 'Workout gear', 'Toiletries']);
  });

  it('groups the packing list by type, falling back to category', async () => {
    const trip = await repo.createTrip({ name: 'T', startDate: '2027-03-10', endDate: '2027-03-12' });
    const d = await repo.createDestination(trip.id, { name: 'D' });
    const p = await repo.createPlace(d.id, { name: 'P', type: 'Restaurant' });
    const dinner = await repo.createActivity(p.id, { name: 'Dinner', start: '2027-03-10T19:00', end: '2027-03-10T21:00' });
    const show = await repo.createActivity(p.id, { name: 'Show', start: '2027-03-11T19:00', end: '2027-03-11T22:00' });
    const add = async (name: string, category: Parameters<typeof repo.createItem>[0]['category'], kind: string, acts: string[]) => {
      const i = await repo.createItem({ name, category, kind });
      for (const a of acts) await repo.addItemToActivity(a, i.id);
    };
    await add('Navy blazer', 'Clothing', 'Jackets & coats', [dinner.id, show.id]);
    await add('Oxford shirt', 'Clothing', 'Shirts', [dinner.id]);
    await add('Loafers', 'Shoes', '', [dinner.id]); // no type: falls back to category "Shoes"
    await add('Sneakers', 'Clothing', 'Shoes', [show.id]); // typed "Shoes": same group
    await add('Toothbrush', 'Toiletries', '', [dinner.id]);
    await add('Resistance band', 'Gear', 'Workout gear', [show.id]);

    const [destinations, places, activities, activityItems, packStatus, items] = await Promise.all([
      db.destinations.toArray(), db.places.toArray(), db.activities.toArray(),
      db.activityItems.toArray(), db.packStatus.toArray(), db.items.toArray(),
    ]);
    const entries = buildPackingList({ trip, destinations, places, activities, activityItems, packStatus, items });
    const groups = groupPackingList(entries, 'type');
    expect(groups.map((g) => g.label)).toEqual(['Shirts', 'Jackets & coats', 'Shoes', 'Workout gear', 'Toiletries']);
    expect(groups.find((g) => g.label === 'Shoes')!.entries.map((e) => e.item.name)).toEqual(['Loafers', 'Sneakers']);
    // The blazer lists both activities it's worn on — in the text export too.
    expect(entries.find((e) => e.item.name === 'Navy blazer')!.usages.map((u) => u.activity.name)).toEqual(['Dinner', 'Show']);
    expect(packingListToText('T', groups)).toContain('☐ Navy blazer — Dinner, Show');
  });
});

describe('suggestKind picks the noun that names the thing', () => {
  it.each([
    ['Dress shoes', 'Shoes'],
    ['Shirt dress', 'Dresses & skirts'],
    ['Rain jacket', 'Jackets & coats'],
    ['Hiking boots', 'Shoes'],
    ['Swim trunks', 'Swimwear'],
    ['Running shorts', 'Shorts'],
  ])('%s → %s', (name, kind) => expect(suggestKind(name)).toBe(kind));
});
