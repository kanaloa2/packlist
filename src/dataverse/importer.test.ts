import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { applyPlan, buildPlan, fetchSource, guessPlaceType, stableId, toLocalDateTime, T, type Source } from './importer';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [T1, T2, D1, D2, P1, P2, P3, P4, A1, A2, A3, A4, A5, A6, I1, I2, I3, I4] = Array.from({ length: 18 }, (_, i) => id(i + 1));

function source(): Source {
  return {
    trips: [
      { [T.trip.id]: T1, cr282_title: 'Vegas', cr282_description: 'Birthday', cr282_start: '2027-03-10T00:00:00', cr282_end: '2027-03-12T00:00:00', cr282_imageid: 'img' },
      { [T.trip.id]: T2, cr282_title: 'NYC', cr282_start: '2027-04-01T00:00:00', cr282_end: '2027-04-03T00:00:00' },
    ],
    destinations: [
      { [T.destination.id]: D1, cr282_title: 'Las Vegas', cr282_description: 'Strip' },
      { [T.destination.id]: D2, cr282_title: 'Shared Beach', cr282_imageid: 'img' },
    ],
    places: [
      { [T.place.id]: P1, cr282_title: 'Bellagio Hotel', _cr282_packlist_destination_value: D1 },
      { [T.place.id]: P2, cr282_title: 'Prime Steakhouse', _cr282_packlist_destination_value: D1 },
      { [T.place.id]: P3, cr282_title: 'Sunny Beach', _cr282_packlist_destination_value: D2 },
      { [T.place.id]: P4, cr282_title: 'Orphan place' },
    ],
    activities: [
      { [T.activity.id]: A1, cr282_title: 'Check in', cr282_start: '2027-03-10T15:00:00', cr282_stop: '2027-03-10T16:00:00', _cr282_packlist_place_value: P1, _cr282_packlist_trip_value: T1 },
      { [T.activity.id]: A2, cr282_title: 'Dinner', cr282_start: '2027-03-13T19:00:00', _cr282_packlist_place_value: P2, _cr282_packlist_trip_value: T1 },
      { [T.activity.id]: A3, cr282_title: 'Swim', cr282_start: '2027-03-11T10:00:00', _cr282_packlist_place_value: P3 },
      { [T.activity.id]: A4, cr282_title: 'Walk', cr282_start: '2027-04-02T10:00:00', cr282_stop: '2027-04-02T12:00:00', _cr282_packlist_place_value: P3, _cr282_packlist_trip_value: T2 },
      { [T.activity.id]: A5, cr282_title: 'Lost', cr282_start: '2027-04-01T09:00:00', _cr282_packlist_trip_value: T2 },
      { [T.activity.id]: A6, cr282_title: 'No time', _cr282_packlist_place_value: P1, _cr282_packlist_trip_value: T1 },
    ],
    items: [
      { [T.item.id]: I1, cr282_title: 'Blue shirt', cr282_type: 0, cr282_imageid: 'img' },
      { [T.item.id]: I2, cr282_title: 'Socks', cr282_type: 3 },
      { [T.item.id]: I3, cr282_title: 'Hat', cr282_type: 6 },
      { [T.item.id]: I4, cr282_title: 'Passport', cr282_type: 7 },
    ],
    itemCounts: [
      { _cr282_trip_value: T1, _cr282_item_value: I2, cr282_count: 5, cr282_packed: true, modifiedon: '2026-01-01T00:00:00Z' },
      { _cr282_trip_value: T1, _cr282_item_value: I2, cr282_count: 3, cr282_packed: false, modifiedon: '2026-02-01T00:00:00Z' },
      { _cr282_trip_value: T1, _cr282_item_value: I1, cr282_count: 1, cr282_packed: true, modifiedon: '2026-01-01T00:00:00Z' },
      { _cr282_trip_value: T1, _cr282_item_value: I4, cr282_count: 1, cr282_packed: false, modifiedon: '2026-01-01T00:00:00Z' },
    ],
    tripDestinations: [[T1, D1], [T1, D2], [T2, D2]],
    tripItems: [[T1, I4], [T1, I1]],
    activityItems: [[A1, I1], [A2, I1], [A1, I2], [A1, I2], [A4, I3], [A3, I3]],
  };
}

describe('Dataverse import plan', () => {
  it('builds the trip → destination → place → activity tree, copying shared destinations per trip', async () => {
    const plan = await buildPlan(source(), 'user-1', 1000);
    expect(plan.trips.map((t) => [t.name, t.startDate, t.endDate])).toEqual([
      ['Vegas', '2027-03-10', '2027-03-13'], // widened to fit Dinner on the 13th
      ['NYC', '2027-04-01', '2027-04-03'],
    ]);
    const vegas = plan.trips[0].id;
    const nyc = plan.trips[1].id;
    const destNames = (trip: string) => plan.destinations.filter((d) => d.tripId === trip).map((d) => d.name).sort();
    expect(destNames(vegas)).toEqual(['Las Vegas', 'Shared Beach']);
    expect(destNames(nyc)).toEqual(['Other places', 'Shared Beach']);
    const beachCopies = plan.destinations.filter((d) => d.name === 'Shared Beach');
    expect(new Set(beachCopies.map((d) => d.id)).size).toBe(2);
    expect(plan.places.map((p) => `${p.name}:${p.type}`).sort()).toEqual([
      'Bellagio Hotel:Hotel', 'Prime Steakhouse:Restaurant', 'Sunny Beach:Pool / Beach', 'Sunny Beach:Pool / Beach', 'Unassigned place:Other',
    ]);
    expect(plan.places.some((p) => p.name === 'Orphan place')).toBe(false); // no destination, no activities
    // Every child points at a parent in the same trip.
    for (const p of plan.places) expect(plan.destinations.find((d) => d.id === p.destinationId)?.tripId).toBe(p.tripId);
    for (const a of plan.activities) {
      const place = plan.places.find((p) => p.id === a.placeId)!;
      expect([place.tripId, place.destinationId]).toEqual([a.tripId, a.destinationId]);
    }
  });

  it('imports activities with sensible times and reports what it skipped', async () => {
    const plan = await buildPlan(source(), 'user-1');
    expect(plan.activities.map((a) => [a.name, a.start, a.end])).toEqual([
      ['Check in', '2027-03-10T15:00', '2027-03-10T16:00'],
      ['Dinner', '2027-03-13T19:00', '2027-03-13T20:00'], // no stop → 1 hour
      ['Walk', '2027-04-02T10:00', '2027-04-02T12:00'],
      ['Lost', '2027-04-01T09:00', '2027-04-01T10:00'],
    ]);
    expect(plan.warnings.join('\n')).toMatch(/Skipped activity “Swim”: it isn’t linked to a trip \(its destination is on several trips\)/);
    expect(plan.warnings.join('\n')).toMatch(/Skipped activity “No time”: it has no start time/);
    expect(plan.warnings.join('\n')).toMatch(/moved the end to 2027-03-13/);
    expect(plan.warnings.join('\n')).toMatch(/1 activity has no place/);
  });

  it('maps item types, links, packed ticks and counts', async () => {
    const plan = await buildPlan(source(), 'user-1');
    expect(plan.items.map((i) => [i.name, i.category, i.kind, i.countRule])).toEqual([
      ['Blue shirt', 'Clothing', 'Shirts', 'trip'],
      ['Socks', 'Clothing', 'Socks', 'perDay'],
      ['Hat', 'Accessories', 'Accessories', 'trip'],
      ['Passport', 'Other', '', 'trip'],
    ]);
    const nameOf = (itemId: string) => plan.items.find((i) => i.id === itemId)!.name;
    const actOf = (aid: string) => plan.activities.find((a) => a.id === aid)!.name;
    expect(plan.activityItems.map((l) => `${actOf(l.activityId)}/${nameOf(l.itemId)}`).sort()).toEqual([
      'Check in/Blue shirt', 'Check in/Socks', 'Dinner/Blue shirt', 'Walk/Hat',
    ]);
    const socks = plan.packStatus.find((s) => nameOf(s.itemId) === 'Socks')!;
    expect(socks).toMatchObject({ packed: false, count: 3 }); // latest row wins
    expect(plan.tripOnlyItems).toEqual([{ trip: 'Vegas', items: ['Passport'] }]);
    expect(plan.tripItems.map((t) => nameOf(t.itemId))).toEqual(['Passport']); // becomes a whole-trip item
    expect(plan.tripItems[0].tripId).toBe(plan.trips[0].id);
    expect(plan.photos.map((p) => [p.table, p.ids.length, p.record])).toEqual([
      ['trips', 1, `cr282_packlist_trips(${T1})`],
      ['destinations', 2, `cr282_packlist_destinations(${D2})`], // one image, two copies
      ['items', 1, `cr282_packlist_items(${I1})`],
    ]);
  });

  it('gives the same ids on re-import, and different ids for a different Packlist user', async () => {
    const a = await buildPlan(source(), 'user-1');
    const b = await buildPlan(source(), 'user-1');
    const c = await buildPlan(source(), 'user-2');
    const ids = (p: typeof a) => [...p.trips, ...p.destinations, ...p.places, ...p.activities, ...p.items, ...p.activityItems].map((r) => r.id);
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a).filter((x) => ids(c).includes(x))).toEqual([]);
    expect(await stableId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('applying an import', () => {
  const cfg = { envUrl: 'https://org81670796.crm.dynamics.com', clientId: 'c', tenantId: 't' };
  const fakeImages = {
    token: 'tok',
    fetcher: (async (url: string) =>
      url.includes('?$select=')
        ? new Response(JSON.stringify({}), { status: 200 }) // record has no inline image either
        : url.includes(`cr282_packlist_items(${I1})`) || url.includes('trips(')
          ? new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { status: 200 })
          : new Response(null, { status: 204 })) as unknown as typeof fetch,
  };
  const resize = async (b: Blob) => `data:image/jpeg;base64,${b.size}`;

  it('saves everything, downloads photos, and keeps only counts that differ from automatic', async () => {
    const plan = await buildPlan(source(), 'user-1');
    const r = await applyPlan(cfg, plan, { includePhotos: true, deps: fakeImages, resize });
    expect(r).toMatchObject({ photos: 2, photoFailures: 0, photoMissing: 1 }); // the destination image came back empty
    expect(await db.trips.count()).toBe(2);
    expect(await db.activities.count()).toBe(4);
    expect(await db.activityItems.count()).toBe(4);
    expect(await db.tripItems.count()).toBe(1);
    expect((await db.trips.get(plan.trips[0].id))?.photo).toBe('data:image/jpeg;base64,3');
    const socks = plan.items.find((i) => i.name === 'Socks')!;
    const shirt = plan.items.find((i) => i.name === 'Blue shirt')!;
    const vegas = plan.trips[0].id;
    // Socks: one per day × 4 days = 4 automatically; Dataverse says 3 → manual 3.
    expect(await db.packStatus.get(`${vegas}:${socks.id}`)).toMatchObject({ quantity: 3, packed: false });
    // Shirt: Dataverse count 1 equals the automatic 1 → stays automatic.
    expect(await db.packStatus.get(`${vegas}:${shirt.id}`)).toMatchObject({ quantity: null, packed: true });
  });

  it('re-importing updates in place and keeps photos added in Packlist', async () => {
    const plan = await buildPlan(source(), 'user-1');
    await applyPlan(cfg, plan, { includePhotos: false, resize });
    const hat = plan.items.find((i) => i.name === 'Hat')!;
    await db.items.update(hat.id, { photo: 'data:image/jpeg;base64,mine' });
    await applyPlan(cfg, await buildPlan(source(), 'user-1'), { includePhotos: true, deps: fakeImages, resize });
    expect(await db.items.count()).toBe(4);
    expect(await db.destinations.count()).toBe(4);
    expect((await db.items.get(hat.id))?.photo).toBe('data:image/jpeg;base64,mine');
  });
});

describe('reading from Dataverse', () => {
  it('reads every table, follows paging, and combines both activity↔item relationships', async () => {
    const seen: string[] = [];
    const base = 'https://org81670796.crm.dynamics.com/api/data/v9.2/';
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    const fetcher = (async (url: string) => {
      const path = decodeURIComponent(url.slice(base.length));
      seen.push(path);
      if (path.startsWith(`EntityDefinitions(LogicalName='${T.trip.table}')`))
        return json({ ManyToManyRelationships: [
          { SchemaName: 'td', Entity1LogicalName: T.trip.table, Entity2LogicalName: T.destination.table, Entity1NavigationPropertyName: 'navTripDest', Entity2NavigationPropertyName: 'x' },
          { SchemaName: 'ti', Entity1LogicalName: T.item.table, Entity2LogicalName: T.trip.table, Entity1NavigationPropertyName: 'x', Entity2NavigationPropertyName: 'navTripItem' },
        ] });
      if (path.startsWith(`EntityDefinitions(LogicalName='${T.activity.table}')`))
        return json({ ManyToManyRelationships: [
          { SchemaName: 'ai1', Entity1LogicalName: T.item.table, Entity2LogicalName: T.activity.table, Entity1NavigationPropertyName: 'x', Entity2NavigationPropertyName: 'navAI1' },
          { SchemaName: 'ai2', Entity1LogicalName: T.activity.table, Entity2LogicalName: T.item.table, Entity1NavigationPropertyName: 'navAI2', Entity2NavigationPropertyName: 'x' },
        ] });
      if (path.includes('ImageAttributeMetadata'))
        return json({ value: path.includes(T.item.table) ? [{ LogicalName: 'cr282_photo', CanStoreFullImage: true, IsPrimaryImage: true }] : [] });
      if (path.startsWith(T.trip.set)) return json({ value: [{ [T.trip.id]: T1, navTripDest: [{ [T.destination.id]: D1 }], navTripItem: [{ [T.item.id]: I4 }] }] });
      if (path.startsWith(T.activity.set)) return json({ value: [{ [T.activity.id]: A1, navAI1: [{ [T.item.id]: I1 }], navAI2: [{ [T.item.id]: I2 }] }] });
      if (path.startsWith(`${T.item.set}?$skiptoken`)) return json({ value: [{ [T.item.id]: I2, cr282_photoid: null }] });
      if (path.startsWith(`${T.item.set}?`)) return json({ value: [{ [T.item.id]: I1, cr282_photoid: 'img-1' }], '@odata.nextLink': `${base}${T.item.set}?$skiptoken=2` });
      return json({ value: [] });
    }) as unknown as typeof fetch;
    const src = await fetchSource({ envUrl: 'https://org81670796.crm.dynamics.com', clientId: 'c', tenantId: 't' }, { fetcher, token: 'tok' });
    expect(src.tripDestinations).toEqual([[T1, D1]]);
    expect(src.tripItems).toEqual([[T1, I4]]);
    expect(src.activityItems).toEqual([[A1, I1], [A1, I2]]);
    expect(src.items).toHaveLength(2); // second page followed
    // Image columns come from metadata: items have one (cr282_photo, full size), trips don't.
    expect(src.images?.item).toEqual({ column: 'cr282_photo', full: true });
    expect(src.images?.trip).toBeNull();
    expect(seen.find((p) => p.startsWith(`${T.item.set}?`))).toContain('cr282_photoid');
    expect(src.items.map((i) => i.__image)).toEqual([true, false]);
    const plan = await buildPlan({ ...src, places: [], destinations: [] }, 'user-1');
    expect(plan.photos.map((p) => [p.record, p.image.column, p.image.full])).toEqual([[`cr282_packlist_items(${I1})`, 'cr282_photo', true]]);
    expect(seen.find((p) => p.startsWith(T.activity.set))).toContain('$expand=navAI1(');
    expect(seen.filter((p) => !p.startsWith('EntityDefinitions')).every((p) => p.includes('statecode eq 0') || p.includes('skiptoken'))).toBe(true);
  });
});

describe('helpers', () => {
  it('converts Dataverse dates to local time', () => {
    expect(toLocalDateTime('2027-03-10')).toBe('2027-03-10T00:00');
    expect(toLocalDateTime('2027-03-10T15:30:00')).toBe('2027-03-10T15:30');
    const d = new Date('2027-03-10T15:30:00Z');
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(toLocalDateTime('2027-03-10T15:30:00Z')).toBe(local);
    expect(toLocalDateTime(null)).toBeNull();
  });
  it('guesses place types from names', () => {
    expect(guessPlaceType('The Grand Resort')).toBe('Hotel');
    expect(guessPlaceType('Joe’s Pizzeria')).toBe('Restaurant');
    expect(guessPlaceType('LAX Airport')).toBe('Transport');
    expect(guessPlaceType('Aunt May’s house')).toBe('Other');
  });
});

describe('import order', () => {
  it('orders destinations and places by their first activity', async () => {
    const plan = await buildPlan(source(), 'user-1');
    const vegas = plan.trips[0].id;
    const byCreated = <R extends { createdAt: number; name: string; tripId: string }>(rows: R[]) =>
      rows.filter((r) => r.tripId === vegas).sort((a, b) => a.createdAt - b.createdAt).map((r) => r.name);
    expect(byCreated(plan.places)).toEqual(['Bellagio Hotel', 'Prime Steakhouse', 'Sunny Beach']);
    expect(byCreated(plan.destinations)).toEqual(['Las Vegas', 'Shared Beach']);
  });
});

describe('import into the places library', () => {
  const cfg = { envUrl: 'https://org81670796.crm.dynamics.com', clientId: 'c', tenantId: 't' };
  const resize = async () => 'data:image/jpeg;base64,x';

  it('creates one library place per Dataverse place, shared by its copies on several trips', async () => {
    const plan = await buildPlan(source(), 'user-1');
    expect(plan.libraryPlaces.map((l) => l.name).sort()).toEqual(['Bellagio Hotel', 'Prime Steakhouse', 'Sunny Beach']);
    const beaches = plan.places.filter((p) => p.name === 'Sunny Beach');
    expect(beaches).toHaveLength(2);
    expect(new Set(beaches.map((p) => p.libraryId)).size).toBe(1);
    expect(plan.places.find((p) => p.name === 'Unassigned place')?.libraryId).toBeUndefined();
  });

  it('re-import keeps using the library entry a place is already linked to', async () => {
    const plan = await buildPlan(source(), 'user-1');
    await applyPlan(cfg, plan, { includePhotos: false, resize });
    expect(await db.placeLibrary.count()).toBe(3);
    // Simulate the server's one-time backfill having linked Bellagio to a different entry.
    const bellagio = plan.places.find((p) => p.name === 'Bellagio Hotel')!;
    await db.placeLibrary.delete(bellagio.libraryId!);
    await db.placeLibrary.add({ id: 'backfilled-lib', name: 'Bellagio Hotel', description: '', type: 'Hotel', address: '', createdAt: 1, updatedAt: 1 });
    await db.places.update(bellagio.id, { libraryId: 'backfilled-lib' });
    await applyPlan(cfg, await buildPlan(source(), 'user-1'), { includePhotos: false, resize });
    expect((await db.places.get(bellagio.id))?.libraryId).toBe('backfilled-lib');
    expect(await db.placeLibrary.count()).toBe(3); // no duplicate Bellagio
  });
});

describe('downloading images', async () => {
  const { downloadImage } = await import('./importer');
  const cfg = { envUrl: 'https://org81670796.crm.dynamics.com', clientId: 'c', tenantId: 't' };
  const job = (full: boolean) => ({ table: 'items' as const, ids: ['x'], record: `cr282_packlist_items(${I1})`, image: { column: 'cr282_photo', full } });
  const img = () => new Response(new Blob([new Uint8Array([9, 9])], { type: 'image/png' }), { status: 200 });
  function fake(routes: (path: string) => Response) {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      const path = decodeURIComponent(url.replace('https://org81670796.crm.dynamics.com/api/data/v9.2/', ''));
      seen.push(path);
      return routes(path);
    }) as unknown as typeof fetch;
    return { deps: { fetcher, token: 't' }, seen };
  }

  it('asks for the full-size image when stored, falling back to the standard one', async () => {
    const { deps, seen } = fake((p) => (p.endsWith('?size=full') ? new Response(null, { status: 404 }) : img()));
    expect((await downloadImage(cfg, job(true), deps))?.size).toBe(2);
    expect(seen).toEqual([`cr282_packlist_items(${I1})/cr282_photo/$value?size=full`, `cr282_packlist_items(${I1})/cr282_photo/$value`]);
  });

  it('skips the full-size request when only standard images are stored', async () => {
    const { deps, seen } = fake(() => img());
    await downloadImage(cfg, job(false), deps);
    expect(seen).toEqual([`cr282_packlist_items(${I1})/cr282_photo/$value`]);
  });

  it('falls back to the small inline copy on the record', async () => {
    const { deps } = fake((p) => (p.includes('?$select=') ? new Response(JSON.stringify({ cr282_photo: btoa('abc') }), { status: 200 }) : new Response(null, { status: 204 })));
    expect((await downloadImage(cfg, job(true), deps))?.size).toBe(3);
  });

  it('reports the error when every attempt fails, and null when there is simply no image', async () => {
    const bad = fake(() => new Response(JSON.stringify({ error: { message: 'Could not find a property named cr282_photo' } }), { status: 400 }));
    await expect(downloadImage(cfg, job(true), bad.deps)).rejects.toThrow(/Could not find a property/);
    const none = fake((p) => (p.includes('?$select=') ? new Response(JSON.stringify({ cr282_photo: null }), { status: 200 }) : new Response(null, { status: 204 })));
    expect(await downloadImage(cfg, job(false), none.deps)).toBeNull();
  });
});
