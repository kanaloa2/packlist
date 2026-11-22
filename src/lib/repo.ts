import { db, newId, ALL_TABLES } from '../db';
import type {
  Activity,
  ActivityItem,
  Destination,
  Item,
  CountRule,
  ItemCategory,
  LibraryPlace,
  PackStatus,
  Place,
  TripItem,
  PlaceType,
  Trip,
} from '../types';
import { datePart, dayCount, shiftYmd, validateActivityTimes, validateTripDates } from './dates';

export { shiftYmd };

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface Common {
  name: string;
  description?: string;
  photo?: string;
}

function requireName(name: string) {
  if (!name.trim()) throw new ValidationError('Name is required.', 'name');
}

function stamp() {
  const now = Date.now();
  return { createdAt: now, updatedAt: now };
}

// ---------- Trips ----------

export interface TripInput extends Common {
  startDate: string;
  endDate: string;
}

export async function createTrip(input: TripInput): Promise<Trip> {
  requireName(input.name);
  const err = validateTripDates(input.startDate, input.endDate);
  if (err) throw new ValidationError(err.message, err.field);
  const trip: Trip = {
    id: newId(),
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    startDate: input.startDate,
    endDate: input.endDate,
    ...stamp(),
  };
  await db.trips.add(trip);
  return trip;
}

/** Activities that would fall outside the trip if its dates changed to [startDate, endDate]. */
export async function activitiesOutside(tripId: string, startDate: string, endDate: string) {
  const acts = await db.activities.where('tripId').equals(tripId).toArray();
  return acts.filter(
    (a) =>
      datePart(a.start) < startDate ||
      datePart(a.start) > endDate ||
      datePart(a.end) < startDate ||
      datePart(a.end) > endDate,
  );
}

export async function updateTrip(id: string, input: TripInput): Promise<void> {
  requireName(input.name);
  const err = validateTripDates(input.startDate, input.endDate);
  if (err) throw new ValidationError(err.message, err.field);
  const outside = await activitiesOutside(id, input.startDate, input.endDate);
  if (outside.length) {
    const names = outside.slice(0, 3).map((a) => `“${a.name}”`).join(', ');
    throw new ValidationError(
      `${outside.length} activit${outside.length === 1 ? 'y' : 'ies'} (${names}${outside.length > 3 ? '…' : ''}) would fall outside these dates. Move them first.`,
      'startDate',
    );
  }
  await db.trips.update(id, {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    startDate: input.startDate,
    endDate: input.endDate,
    updatedAt: Date.now(),
  });
}

export async function deleteTrip(id: string): Promise<void> {
  await db.transaction('rw', [...ALL_TABLES], async () => {
    await db.activityItems.where('tripId').equals(id).delete();
    await db.tripItems.where('tripId').equals(id).delete();
    await db.packStatus.where('tripId').equals(id).delete();
    await db.activities.where('tripId').equals(id).delete();
    await db.places.where('tripId').equals(id).delete();
    await db.destinations.where('tripId').equals(id).delete();
    await db.trips.delete(id);
  });
}

/** Copies a trip's whole itinerary (destinations, places, activities, items) shifted to a new start date. */
export async function duplicateTrip(id: string, name: string, startDate: string): Promise<Trip> {
  const trip = await db.trips.get(id);
  if (!trip) throw new Error('Trip not found');
  const offsetDays = Math.round(
    (new Date(startDate + 'T00:00').getTime() - new Date(trip.startDate + 'T00:00').getTime()) /
      86_400_000,
  );
  const shiftDate = (ymd: string) => shiftYmd(ymd, offsetDays);
  const shiftDateTime = (v: string) => shiftDate(datePart(v)) + v.slice(10);

  return db.transaction('rw', [...ALL_TABLES], async () => {
    const newTrip: Trip = {
      ...trip,
      id: newId(),
      name,
      startDate: shiftDate(trip.startDate),
      endDate: shiftDate(trip.endDate),
      ...stamp(),
    };
    await db.trips.add(newTrip);
    const destMap = new Map<string, string>();
    const placeMap = new Map<string, string>();
    const actMap = new Map<string, string>();
    for (const d of await db.destinations.where('tripId').equals(id).toArray()) {
      const nid = newId();
      destMap.set(d.id, nid);
      await db.destinations.add({ ...d, id: nid, tripId: newTrip.id, ...stamp() });
    }
    for (const p of await db.places.where('tripId').equals(id).toArray()) {
      const nid = newId();
      placeMap.set(p.id, nid);
      await db.places.add({
        ...p,
        id: nid,
        tripId: newTrip.id,
        destinationId: destMap.get(p.destinationId)!,
        ...stamp(),
      });
    }
    for (const a of await db.activities.where('tripId').equals(id).toArray()) {
      const nid = newId();
      actMap.set(a.id, nid);
      await db.activities.add({
        ...a,
        id: nid,
        tripId: newTrip.id,
        destinationId: destMap.get(a.destinationId)!,
        placeId: placeMap.get(a.placeId)!,
        start: shiftDateTime(a.start),
        end: shiftDateTime(a.end),
        ...stamp(),
      });
    }
    for (const ai of await db.activityItems.where('tripId').equals(id).toArray()) {
      await db.activityItems.add({
        ...ai,
        id: newId(),
        tripId: newTrip.id,
        activityId: actMap.get(ai.activityId)!,
        createdAt: Date.now(),
      });
    }
    for (const ti of await db.tripItems.where('tripId').equals(id).toArray()) {
      await db.tripItems.add({ ...ti, id: newId(), tripId: newTrip.id, createdAt: Date.now() });
    }
    return newTrip;
  });
}


// ---------- Destinations ----------

export async function createDestination(tripId: string, input: Common): Promise<Destination> {
  requireName(input.name);
  if (!(await db.trips.get(tripId))) throw new Error('Trip not found');
  const dest: Destination = {
    id: newId(),
    tripId,
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    ...stamp(),
  };
  await db.destinations.add(dest);
  return dest;
}

export async function updateDestination(id: string, input: Common): Promise<void> {
  requireName(input.name);
  await db.destinations.update(id, {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    updatedAt: Date.now(),
  });
}

async function deleteActivitiesWhere(field: 'destinationId' | 'placeId', id: string) {
  const acts = await db.activities.where(field).equals(id).primaryKeys();
  if (acts.length) await db.activityItems.where('activityId').anyOf(acts).delete();
  await db.activities.bulkDelete(acts);
}

export async function deleteDestination(id: string): Promise<void> {
  await db.transaction('rw', [db.destinations, db.places, db.activities, db.activityItems], async () => {
    await deleteActivitiesWhere('destinationId', id);
    await db.places.where('destinationId').equals(id).delete();
    await db.destinations.delete(id);
  });
}

// ---------- Places ----------
//
// A place on a trip (`places`) is an instance of a place in the user's library
// (`placeLibrary`). Its details are a copy kept in step with the library entry: editing a
// place updates the library and every trip that uses it.

export interface PlaceInput extends Common {
  type: PlaceType;
  address?: string;
}

function placeDetails(input: PlaceInput) {
  return {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    type: input.type,
    address: input.address ?? '',
  };
}

/** Adds a place to the library only (not to any trip). */
export async function createLibraryPlace(input: PlaceInput): Promise<LibraryPlace> {
  requireName(input.name);
  const lib: LibraryPlace = { id: newId(), ...placeDetails(input), ...stamp() };
  await db.placeLibrary.add(lib);
  return lib;
}

/** Edits a library place and every trip place linked to it. */
export async function updateLibraryPlace(id: string, input: PlaceInput): Promise<void> {
  requireName(input.name);
  const details = { ...placeDetails(input), updatedAt: Date.now() };
  await db.transaction('rw', [db.placeLibrary, db.places], async () => {
    await db.placeLibrary.update(id, details);
    await db.places.where('libraryId').equals(id).modify(details);
  });
}

/**
 * Deletes a place from the library. Trips that use it keep their copy (unlinked), so no
 * itinerary or activity is lost.
 */
export async function deleteLibraryPlace(id: string): Promise<void> {
  await db.transaction('rw', [db.placeLibrary, db.places], async () => {
    await db.placeLibrary.delete(id);
    await db.places.where('libraryId').equals(id).modify((p) => {
      delete p.libraryId;
    });
  });
}

/** Creates a new place: added to the library and to the destination. */
export async function createPlace(destinationId: string, input: PlaceInput): Promise<Place> {
  requireName(input.name);
  const dest = await db.destinations.get(destinationId);
  if (!dest) throw new Error('Destination not found');
  return db.transaction('rw', [db.placeLibrary, db.places], async () => {
    const lib = await createLibraryPlace(input);
    const place: Place = { id: newId(), tripId: dest.tripId, destinationId, libraryId: lib.id, ...placeDetails(input), ...stamp() };
    await db.places.add(place);
    return place;
  });
}

/** Puts a library place on a trip, under the given destination. */
export async function addPlaceFromLibrary(destinationId: string, libraryId: string): Promise<Place> {
  const [dest, lib] = await Promise.all([db.destinations.get(destinationId), db.placeLibrary.get(libraryId)]);
  if (!dest) throw new Error('Destination not found');
  if (!lib) throw new Error('Place not found in your library');
  const place: Place = {
    id: newId(),
    tripId: dest.tripId,
    destinationId,
    libraryId,
    name: lib.name,
    description: lib.description,
    photo: lib.photo,
    type: lib.type,
    address: lib.address,
    ...stamp(),
  };
  await db.places.add(place);
  return place;
}

/** Edits a trip place: its library entry and every other trip using it change too. */
export async function updatePlace(id: string, input: PlaceInput): Promise<void> {
  requireName(input.name);
  const place = await db.places.get(id);
  if (!place) throw new Error('Place not found');
  if (place.libraryId && (await db.placeLibrary.get(place.libraryId))) {
    await updateLibraryPlace(place.libraryId, input);
    return;
  }
  // Not linked yet (or its library entry was deleted): give it one now.
  await db.transaction('rw', [db.placeLibrary, db.places], async () => {
    const lib = await createLibraryPlace(input);
    await db.places.update(id, { ...placeDetails(input), libraryId: lib.id, updatedAt: Date.now() });
  });
}

/** Removes a place from its trip, with its activities there. It stays in the library. */
export async function removePlaceFromTrip(id: string): Promise<void> {
  await db.transaction('rw', [db.places, db.activities, db.activityItems], async () => {
    await deleteActivitiesWhere('placeId', id);
    await db.places.delete(id);
  });
}

/**
 * Moves a place, with its activities, to another destination on the same trip or another
 * trip. Moving to another trip keeps activity times if they fit its dates; otherwise they
 * shift by the gap between the two trips' start dates. Returns that shift in days.
 */
export async function movePlace(placeId: string, toDestinationId: string): Promise<{ shiftedDays: number }> {
  const place = await db.places.get(placeId);
  const toDest = await db.destinations.get(toDestinationId);
  if (!place) throw new Error('Place not found');
  if (!toDest) throw new Error('Destination not found');
  if (toDest.id === place.destinationId) throw new ValidationError('It’s already in that destination.');
  const [fromTrip, toTrip] = await Promise.all([db.trips.get(place.tripId), db.trips.get(toDest.tripId)]);
  if (!fromTrip || !toTrip) throw new Error('Trip not found');
  const acts = await db.activities.where('placeId').equals(placeId).toArray();

  let shiftedDays = 0;
  if (toTrip.id !== fromTrip.id) {
    const fits = (days: number) =>
      acts.every((a) => !validateActivityTimes(shiftDateTime(a.start, days), shiftDateTime(a.end, days), toTrip.startDate, toTrip.endDate));
    if (!fits(0)) {
      shiftedDays = dayCount(fromTrip.startDate, toTrip.startDate) - 1;
      if (!fits(shiftedDays)) {
        const bad = acts.filter((a) => validateActivityTimes(shiftDateTime(a.start, shiftedDays), shiftDateTime(a.end, shiftedDays), toTrip.startDate, toTrip.endDate));
        throw new ValidationError(
          `${bad.length} activit${bad.length === 1 ? 'y' : 'ies'} (${bad.slice(0, 3).map((a) => `“${a.name}”`).join(', ')}) wouldn’t fit within “${toTrip.name}” (${toTrip.startDate} – ${toTrip.endDate}). Extend that trip’s dates first.`,
        );
      }
    }
  }

  await db.transaction('rw', [db.places, db.activities, db.activityItems], async () => {
    const now = Date.now();
    await db.places.update(placeId, { tripId: toTrip.id, destinationId: toDest.id, updatedAt: now });
    for (const a of acts) {
      await db.activities.update(a.id, {
        tripId: toTrip.id,
        destinationId: toDest.id,
        start: shiftDateTime(a.start, shiftedDays),
        end: shiftDateTime(a.end, shiftedDays),
        updatedAt: now,
      });
    }
    if (acts.length && toTrip.id !== fromTrip.id) {
      await db.activityItems.where('activityId').anyOf(acts.map((a) => a.id)).modify({ tripId: toTrip.id });
    }
  });
  return { shiftedDays };
}

function shiftDateTime(v: string, days: number): string {
  return days ? shiftYmd(datePart(v), days) + v.slice(10) : v;
}

// ---------- Activities ----------

export interface ActivityInput extends Common {
  start: string;
  end: string;
}

async function checkActivityTimes(tripId: string, input: ActivityInput) {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error('Trip not found');
  const err = validateActivityTimes(input.start, input.end, trip.startDate, trip.endDate);
  if (err) throw new ValidationError(err.message, err.field);
}

export async function createActivity(placeId: string, input: ActivityInput): Promise<Activity> {
  requireName(input.name);
  const place = await db.places.get(placeId);
  if (!place) throw new Error('Place not found');
  await checkActivityTimes(place.tripId, input);
  const act: Activity = {
    id: newId(),
    tripId: place.tripId,
    destinationId: place.destinationId,
    placeId,
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    start: input.start,
    end: input.end,
    ...stamp(),
  };
  await db.activities.add(act);
  return act;
}

export async function updateActivity(id: string, input: ActivityInput): Promise<void> {
  requireName(input.name);
  const act = await db.activities.get(id);
  if (!act) throw new Error('Activity not found');
  await checkActivityTimes(act.tripId, input);
  await db.activities.update(id, {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    start: input.start,
    end: input.end,
    updatedAt: Date.now(),
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await db.transaction('rw', [db.activities, db.activityItems], async () => {
    await db.activityItems.where('activityId').equals(id).delete();
    await db.activities.delete(id);
  });
}

// ---------- Items ----------

export interface ItemInput extends Common {
  category: ItemCategory;
  countRule?: CountRule;
  kind?: string;
}

export async function createItem(input: ItemInput): Promise<Item> {
  requireName(input.name);
  const item: Item = {
    id: newId(),
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    category: input.category,
    countRule: input.countRule ?? 'trip',
    kind: (input.kind ?? '').trim(),
    ...stamp(),
  };
  await db.items.add(item);
  return item;
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
  requireName(input.name);
  await db.items.update(id, {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    category: input.category,
    countRule: input.countRule ?? 'trip',
    kind: (input.kind ?? '').trim(),
    updatedAt: Date.now(),
  });
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', [db.items, db.activityItems, db.tripItems, db.packStatus], async () => {
    await db.activityItems.where('itemId').equals(id).delete();
    await db.tripItems.where('itemId').equals(id).delete();
    await db.packStatus.where('itemId').equals(id).delete();
    await db.items.delete(id);
  });
}

// ---------- Activity ⇄ Item ----------

/** Adds an item to an activity; if it's already there, bumps nothing and returns the existing link. */
export async function addItemToActivity(
  activityId: string,
  itemId: string,
  quantity = 1,
): Promise<ActivityItem> {
  const act = await db.activities.get(activityId);
  if (!act) throw new Error('Activity not found');
  const existing = await db.activityItems
    .where('activityId')
    .equals(activityId)
    .filter((ai) => ai.itemId === itemId)
    .first();
  if (existing) return existing;
  const link: ActivityItem = {
    id: newId(),
    tripId: act.tripId,
    activityId,
    itemId,
    quantity: Math.max(1, Math.floor(quantity)),
    note: '',
    createdAt: Date.now(),
  };
  await db.activityItems.add(link);
  return link;
}

export async function updateActivityItem(id: string, changes: { quantity?: number; note?: string }) {
  const patch: Partial<ActivityItem> = {};
  if (changes.quantity !== undefined) patch.quantity = Math.max(1, Math.floor(changes.quantity));
  if (changes.note !== undefined) patch.note = changes.note;
  await db.activityItems.update(id, patch);
}

export async function removeActivityItem(id: string): Promise<void> {
  await db.activityItems.delete(id);
}

// ---------- Trip ⇄ Item (whole-trip items) ----------

/** Adds an item to a whole trip (not tied to an activity); returns the existing link if already there. */
export async function addItemToTrip(tripId: string, itemId: string, quantity = 1): Promise<TripItem> {
  if (!(await db.trips.get(tripId))) throw new Error('Trip not found');
  const existing = await db.tripItems.where('tripId').equals(tripId).filter((t) => t.itemId === itemId).first();
  if (existing) return existing;
  const link: TripItem = { id: newId(), tripId, itemId, quantity: Math.max(1, Math.floor(quantity)), note: '', createdAt: Date.now() };
  await db.tripItems.add(link);
  return link;
}

export async function updateTripItem(id: string, changes: { quantity?: number; note?: string }) {
  const patch: Partial<TripItem> = {};
  if (changes.quantity !== undefined) patch.quantity = Math.max(1, Math.floor(changes.quantity));
  if (changes.note !== undefined) patch.note = changes.note;
  await db.tripItems.update(id, patch);
}

export async function removeItemFromTrip(tripId: string, itemId: string): Promise<void> {
  await db.tripItems.where('tripId').equals(tripId).filter((t) => t.itemId === itemId).delete();
}

/** Where copied items go: an activity, or a trip's whole-trip list. */
export type CopyTarget = { kind: 'activity'; id: string } | { kind: 'trip'; id: string };

/**
 * Adds the given items (with their quantity and note) to the target. Items already there are
 * left as they are. The items themselves aren't duplicated — they live in the shared library,
 * so copying to another trip just links the same item. Returns how many were added.
 */
export async function copyItemLinks(links: { itemId: string; quantity: number; note: string }[], target: CopyTarget): Promise<number> {
  if (target.kind === 'activity') {
    const act = await db.activities.get(target.id);
    if (!act) throw new Error('Activity not found');
    return db.transaction('rw', db.activityItems, async () => {
      const present = new Set((await db.activityItems.where('activityId').equals(act.id).toArray()).map((l) => l.itemId));
      const fresh = dedupe(links).filter((l) => !present.has(l.itemId));
      await db.activityItems.bulkAdd(
        fresh.map((l) => ({ id: newId(), tripId: act.tripId, activityId: act.id, itemId: l.itemId, quantity: Math.max(1, l.quantity), note: l.note, createdAt: Date.now() })),
      );
      return fresh.length;
    });
  }
  if (!(await db.trips.get(target.id))) throw new Error('Trip not found');
  return db.transaction('rw', db.tripItems, async () => {
    const present = new Set((await db.tripItems.where('tripId').equals(target.id).toArray()).map((l) => l.itemId));
    const fresh = dedupe(links).filter((l) => !present.has(l.itemId));
    await db.tripItems.bulkAdd(
      fresh.map((l) => ({ id: newId(), tripId: target.id, itemId: l.itemId, quantity: Math.max(1, l.quantity), note: l.note, createdAt: Date.now() })),
    );
    return fresh.length;
  });
}

function dedupe<T extends { itemId: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  return links.filter((l) => !seen.has(l.itemId) && seen.add(l.itemId));
}

/** Copies all items from one activity onto another (skips ones already there). */
export async function copyActivityItems(fromActivityId: string, toActivityId: string): Promise<number> {
  const links = await db.activityItems.where('activityId').equals(fromActivityId).toArray();
  return copyItemLinks(links, { kind: 'activity', id: toActivityId });
}

// ---------- Packing ----------

// Pack status rows hold both the packed tick and any manual count, so every write
// merges into the existing row instead of replacing it.

async function patchPackStatus(tripId: string, itemIds: string[], patch: Partial<PackStatus>): Promise<void> {
  await db.transaction('rw', db.packStatus, async () => {
    const ids = itemIds.map((itemId) => `${tripId}:${itemId}`);
    const existing = await db.packStatus.bulkGet(ids);
    await db.packStatus.bulkPut(
      itemIds.map((itemId, i) => ({
        ...(existing[i] ?? { id: ids[i], tripId, itemId, packed: false }),
        ...patch,
      })),
    );
  });
}

export async function setPacked(tripId: string, itemId: string, packed: boolean): Promise<void> {
  await patchPackStatus(tripId, [itemId], { packed });
}

export async function setAllPacked(tripId: string, itemIds: string[], packed: boolean): Promise<void> {
  await patchPackStatus(tripId, itemIds, { packed });
}

/** Sets how many of an item to pack on this trip; null goes back to the automatic count. */
export async function setPackQuantity(tripId: string, itemId: string, quantity: number | null): Promise<void> {
  await patchPackStatus(tripId, [itemId], { quantity: quantity === null ? null : Math.max(1, Math.floor(quantity)) });
}
