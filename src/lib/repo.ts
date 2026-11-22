import { db, newId, ALL_TABLES } from '../db';
import type {
  Activity,
  ActivityItem,
  Destination,
  Item,
  CountRule,
  ItemCategory,
  PackStatus,
  Place,
  PlaceType,
  Trip,
} from '../types';
import { datePart, shiftYmd, validateActivityTimes, validateTripDates } from './dates';

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

export interface PlaceInput extends Common {
  type: PlaceType;
  address?: string;
}

export async function createPlace(destinationId: string, input: PlaceInput): Promise<Place> {
  requireName(input.name);
  const dest = await db.destinations.get(destinationId);
  if (!dest) throw new Error('Destination not found');
  const place: Place = {
    id: newId(),
    tripId: dest.tripId,
    destinationId,
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    type: input.type,
    address: input.address ?? '',
    ...stamp(),
  };
  await db.places.add(place);
  return place;
}

export async function updatePlace(id: string, input: PlaceInput): Promise<void> {
  requireName(input.name);
  await db.places.update(id, {
    name: input.name.trim(),
    description: input.description ?? '',
    photo: input.photo,
    type: input.type,
    address: input.address ?? '',
    updatedAt: Date.now(),
  });
}

export async function deletePlace(id: string): Promise<void> {
  await db.transaction('rw', [db.places, db.activities, db.activityItems], async () => {
    await deleteActivitiesWhere('placeId', id);
    await db.places.delete(id);
  });
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
  await db.transaction('rw', [db.items, db.activityItems, db.packStatus], async () => {
    await db.activityItems.where('itemId').equals(id).delete();
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

/** Copies all items from one activity onto another (skips ones already there). */
export async function copyActivityItems(fromActivityId: string, toActivityId: string): Promise<number> {
  const links = await db.activityItems.where('activityId').equals(fromActivityId).toArray();
  let added = 0;
  for (const l of links) {
    const before = await db.activityItems.count();
    await addItemToActivity(toActivityId, l.itemId, l.quantity);
    if ((await db.activityItems.count()) > before) added++;
  }
  return added;
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
