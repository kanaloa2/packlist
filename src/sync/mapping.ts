import type { TableName } from '../db';

/** Postgres table for each local table. */
export const REMOTE_TABLE: Record<TableName, string> = {
  trips: 'trips',
  destinations: 'destinations',
  places: 'places',
  activities: 'activities',
  items: 'items',
  activityItems: 'activity_items',
  packStatus: 'pack_status',
};

/** The fields that sync, per table (local camelCase names). Anything else stays local. */
export const COLUMNS: Record<TableName, readonly string[]> = {
  trips: ['id', 'name', 'description', 'photo', 'startDate', 'endDate', 'createdAt', 'updatedAt'],
  destinations: ['id', 'tripId', 'name', 'description', 'photo', 'createdAt', 'updatedAt'],
  places: ['id', 'tripId', 'destinationId', 'type', 'address', 'name', 'description', 'photo', 'createdAt', 'updatedAt'],
  activities: ['id', 'tripId', 'destinationId', 'placeId', 'name', 'description', 'photo', 'start', 'end', 'createdAt', 'updatedAt'],
  items: ['id', 'category', 'kind', 'countRule', 'name', 'description', 'photo', 'createdAt', 'updatedAt'],
  activityItems: ['id', 'tripId', 'activityId', 'itemId', 'quantity', 'note', 'createdAt'],
  packStatus: ['id', 'tripId', 'itemId', 'packed', 'quantity'],
};

export const HAS_PHOTO: Record<TableName, boolean> = {
  trips: true,
  destinations: true,
  places: true,
  activities: true,
  items: true,
  activityItems: false,
  packStatus: false,
};

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

type Row = Record<string, unknown>;

/**
 * Local row → Postgres row. user_id is deliberately omitted: the database fills it
 * from the signed-in user (auth.uid()), and RLS rejects any attempt to set someone else's.
 */
export function toRemote(table: TableName, row: Row): Row {
  const out: Row = {};
  for (const k of COLUMNS[table]) {
    const v = row[k] ?? DEFAULTS[k];
    out[toSnake(k)] = v === undefined ? null : v;
  }
  return out;
}

/** Values for NOT NULL columns that older local rows may not have. */
const DEFAULTS: Record<string, unknown> = { countRule: 'trip', kind: '' };

/** Postgres row → local row. */
export function fromRemote(table: TableName, row: Row): Row {
  const out: Row = {};
  for (const k of COLUMNS[table]) {
    const v = row[toSnake(k)];
    if (v === null || v === undefined) {
      if (k === 'photo') continue; // absent photo = no property, as created locally
      out[k] = k === 'description' || k === 'note' || k === 'address' || k === 'kind' ? '' : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export { toSnake, toCamel };
