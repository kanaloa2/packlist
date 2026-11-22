import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Activity, ActivityItem, Destination, Item, PackStatus, Place, Trip, TripItem } from './types';

/** undefined = loading, null = not found */
export function useRecord<T>(table: 'trips' | 'destinations' | 'places' | 'placeLibrary' | 'activities' | 'items', id: string | undefined) {
  return useLiveQuery(async () => (id ? (((await db.table(table).get(id)) as T | undefined) ?? null) : null), [table, id]);
}

export interface TripData {
  trip: Trip;
  destinations: Destination[];
  places: Place[];
  activities: Activity[];
  activityItems: ActivityItem[];
  tripItems: TripItem[];
  items: Item[];
  packStatus: PackStatus[];
}

/** Everything belonging to one trip, kept live. undefined = loading, null = not found. */
export function useTripData(tripId: string | undefined): TripData | null | undefined {
  return useLiveQuery(async () => {
    if (!tripId) return null;
    const trip = await db.trips.get(tripId);
    if (!trip) return null;
    const [destinations, places, activities, activityItems, tripItems, packStatus] = await Promise.all([
      db.destinations.where('tripId').equals(tripId).toArray(),
      db.places.where('tripId').equals(tripId).toArray(),
      db.activities.where('tripId').equals(tripId).sortBy('start'),
      db.activityItems.where('tripId').equals(tripId).toArray(),
      db.tripItems.where('tripId').equals(tripId).toArray(),
      db.packStatus.where('tripId').equals(tripId).toArray(),
    ]);
    const itemIds = [...new Set([...activityItems, ...tripItems].map((l) => l.itemId))];
    const items = (await db.items.bulkGet(itemIds)).filter((i): i is Item => !!i);
    destinations.sort((a, b) => a.createdAt - b.createdAt);
    places.sort((a, b) => a.createdAt - b.createdAt);
    return { trip, destinations, places, activities, activityItems, tripItems, items, packStatus };
  }, [tripId]);
}

export function useAllItems() {
  return useLiveQuery(() => db.items.orderBy('name').toArray(), []);
}
