import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';

async function trip(name: string, start: string, end: string, dest = `${name} city`) {
  const t = await repo.createTrip({ name, startDate: start, endDate: end });
  const d = await repo.createDestination(t.id, { name: dest });
  return { t, d };
}

describe('places library', () => {
  it('creating a place on a trip also adds it to the library', async () => {
    const { d } = await trip('Vegas', '2027-03-10', '2027-03-13');
    const p = await repo.createPlace(d.id, { name: 'Bellagio', type: 'Hotel', address: 'Las Vegas Blvd' });
    const lib = await db.placeLibrary.get(p.libraryId!);
    expect(lib).toMatchObject({ name: 'Bellagio', type: 'Hotel', address: 'Las Vegas Blvd' });
  });

  it('a library place can go on several trips, and editing it updates all of them', async () => {
    const vegas = await trip('Vegas', '2027-03-10', '2027-03-13');
    const again = await trip('Vegas again', '2027-09-01', '2027-09-03');
    const lib = await repo.createLibraryPlace({ name: 'Bellagio', type: 'Hotel', description: 'Fountains' });
    const a = await repo.addPlaceFromLibrary(vegas.d.id, lib.id);
    const b = await repo.addPlaceFromLibrary(again.d.id, lib.id);
    expect([a.tripId, b.tripId]).toEqual([vegas.t.id, again.t.id]);
    expect(b).toMatchObject({ name: 'Bellagio', description: 'Fountains', type: 'Hotel', libraryId: lib.id });
    await repo.updatePlace(a.id, { name: 'The Bellagio', type: 'Hotel', description: 'Fountains!', photo: 'data:image/jpeg;base64,x' });
    expect(await db.placeLibrary.get(lib.id)).toMatchObject({ name: 'The Bellagio', description: 'Fountains!' });
    expect(await db.places.get(b.id)).toMatchObject({ name: 'The Bellagio', photo: 'data:image/jpeg;base64,x' });
  });

  it('removing a place from a trip keeps it in the library (its activities there go)', async () => {
    const { d } = await trip('Vegas', '2027-03-10', '2027-03-13');
    const p = await repo.createPlace(d.id, { name: 'Bellagio', type: 'Hotel' });
    await repo.createActivity(p.id, { name: 'Check in', start: '2027-03-10T15:00', end: '2027-03-10T16:00' });
    await repo.removePlaceFromTrip(p.id);
    expect(await db.places.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    expect(await db.placeLibrary.get(p.libraryId!)).toBeDefined();
  });

  it('deleting from the library leaves trips’ places in place, unlinked', async () => {
    const { d } = await trip('Vegas', '2027-03-10', '2027-03-13');
    const p = await repo.createPlace(d.id, { name: 'Bellagio', type: 'Hotel' });
    await repo.deleteLibraryPlace(p.libraryId!);
    const after = await db.places.get(p.id);
    expect(after?.name).toBe('Bellagio');
    expect(after?.libraryId).toBeUndefined();
    // Editing it later re-links it to a fresh library entry.
    await repo.updatePlace(p.id, { name: 'Bellagio', type: 'Hotel' });
    expect((await db.places.get(p.id))?.libraryId).toBeDefined();
    expect(await db.placeLibrary.count()).toBe(1);
  });
});

describe('moving a place', () => {
  async function setup() {
    const vegas = await trip('Vegas', '2027-03-10', '2027-03-13', 'Las Vegas');
    const henderson = await repo.createDestination(vegas.t.id, { name: 'Henderson' });
    const p = await repo.createPlace(vegas.d.id, { name: 'Bellagio', type: 'Hotel' });
    const a = await repo.createActivity(p.id, { name: 'Check in', start: '2027-03-10T15:00', end: '2027-03-10T16:00' });
    const b = await repo.createActivity(p.id, { name: 'Pool', start: '2027-03-12T11:00', end: '2027-03-12T14:00' });
    const shirt = await repo.createItem({ name: 'Shirt', category: 'Clothing' });
    await repo.addItemToActivity(a.id, shirt.id);
    return { vegas, henderson, p, a, b };
  }

  it('moves to another destination on the same trip without changing times', async () => {
    const { henderson, p, a } = await setup();
    expect(await repo.movePlace(p.id, henderson.id)).toEqual({ shiftedDays: 0 });
    expect(await db.places.get(p.id)).toMatchObject({ destinationId: henderson.id });
    expect(await db.activities.get(a.id)).toMatchObject({ destinationId: henderson.id, start: '2027-03-10T15:00' });
  });

  it('moves to another trip, keeping times when they fit', async () => {
    const { p, a } = await setup();
    const longer = await trip('Big trip', '2027-03-01', '2027-03-31');
    expect(await repo.movePlace(p.id, longer.d.id)).toEqual({ shiftedDays: 0 });
    expect(await db.activities.get(a.id)).toMatchObject({ tripId: longer.t.id, destinationId: longer.d.id, start: '2027-03-10T15:00' });
    expect((await db.activityItems.where('activityId').equals(a.id).first())?.tripId).toBe(longer.t.id);
  });

  it('shifts times by the gap between trip starts when they don’t fit', async () => {
    const { p, a, b } = await setup();
    const june = await trip('June', '2027-06-01', '2027-06-05');
    expect(await repo.movePlace(p.id, june.d.id)).toEqual({ shiftedDays: 83 });
    expect((await db.activities.get(a.id))?.start).toBe('2027-06-01T15:00');
    expect((await db.activities.get(b.id))?.end).toBe('2027-06-03T14:00');
  });

  it('refuses when activities still wouldn’t fit, changing nothing', async () => {
    const { p, a } = await setup();
    const short = await trip('Day trip', '2027-06-01', '2027-06-01');
    await expect(repo.movePlace(p.id, short.d.id)).rejects.toThrow(/wouldn’t fit within “Day trip”/);
    expect(await db.activities.get(a.id)).toMatchObject({ start: '2027-03-10T15:00' });
    expect((await db.places.get(p.id))?.destinationId).not.toBe(short.d.id);
  });
});
