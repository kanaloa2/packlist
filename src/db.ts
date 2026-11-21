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
  /** Local changes waiting to be pushed to the server, in the order they happened. */
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  /** Photos by storage path (content-addressed), so each is uploaded/downloaded once. */
  photoCache!: EntityTable<PhotoCacheEntry, 'path'>;
  /** Small key/value store, e.g. which user's data this device holds. */
  meta!: EntityTable<MetaEntry, 'key'>;

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
    this.version(2).stores({
      outbox: '++seq',
      photoCache: 'path',
      meta: 'key',
    });
  }
}

export interface OutboxEntry {
  seq?: number;
  table: TableName;
  key: string;
}

export interface PhotoCacheEntry {
  path: string;
  dataUrl: string;
}

export interface MetaEntry {
  key: string;
  value: string;
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
/** The user-data tables, parents before children (the order rows must be created in). */
export type TableName = (typeof ALL_TABLES)[number];

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
