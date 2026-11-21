import Dexie, { type EntityTable } from 'dexie';
import type {
  Activity,
  ActivityItem,
  Destination,
  Item,
  PackStatus,
  Place,
  Trip,
} from './types';

export class PacklistDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>;
  destinations!: EntityTable<Destination, 'id'>;
  places!: EntityTable<Place, 'id'>;
  activities!: EntityTable<Activity, 'id'>;
  items!: EntityTable<Item, 'id'>;
  activityItems!: EntityTable<ActivityItem, 'id'>;
  packStatus!: EntityTable<PackStatus, 'id'>;

  constructor(name = 'packlist') {
    super(name);
    this.version(1).stores({
      trips: 'id, startDate',
      destinations: 'id, tripId',
      places: 'id, tripId, destinationId',
      activities: 'id, tripId, destinationId, placeId, start',
      items: 'id, name, category',
      activityItems: 'id, tripId, activityId, itemId',
      packStatus: 'id, tripId, itemId',
    });
  }
}

export const db = new PacklistDB();

export const ALL_TABLES = [
  'trips',
  'destinations',
  'places',
  'activities',
  'items',
  'activityItems',
  'packStatus',
] as const;
export type TableName = (typeof ALL_TABLES)[number];

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
