import { db } from '../db';
import type { Activity, ActivityItem, CountRule, Destination, Item, ItemCategory, LibraryPlace, PackStatus, Place, PlaceType, Trip, TripItem } from '../types';
import { buildPackingList } from '../lib/packing';
import { resizeImage } from '../lib/photo';
import { dvGet, dvGetAll, dvGetBlob, type DvDeps } from './api';
import type { DataverseConfig } from './config';

/*
 * Import from the "PackList" Dataverse app (publisher prefix cr282).
 *
 *   PackList_Trip ⇄ PackList_Destination   (many-to-many)
 *   PackList_Place → PackList_Destination  (lookup)
 *   PackList_Activity → Place, → Trip      (lookups)
 *   PackList_Activity ⇄ PackList_Item      (two many-to-many relationships; both are read)
 *   PackList_Trip ⇄ PackList_Item          (many-to-many)
 *   PackList_ItemCount → Trip, → Item      (count + packed per trip)
 *
 * Packlist nests Trip → Destination → Place → Activity, so a Dataverse destination (and its
 * places) used on several trips becomes one copy per trip.
 */

export const T = {
  trip: { table: 'cr282_packlist_trip', set: 'cr282_packlist_trips', id: 'cr282_packlist_tripid' },
  destination: { table: 'cr282_packlist_destination', set: 'cr282_packlist_destinations', id: 'cr282_packlist_destinationid' },
  place: { table: 'cr282_packlist_place', set: 'cr282_packlist_places', id: 'cr282_packlist_placeid' },
  activity: { table: 'cr282_packlist_activity', set: 'cr282_packlist_activities', id: 'cr282_packlist_activityid' },
  item: { table: 'cr282_packlist_item', set: 'cr282_packlist_items', id: 'cr282_packlist_itemid' },
  itemCount: { table: 'cr282_packlist_itemcount', set: 'cr282_packlist_itemcounts', id: 'cr282_packlist_itemcountid' },
} as const;

/** An image column on a table, as found in Dataverse metadata. */
export interface ImageColumn {
  column: string;
  /** Whether full-size images are stored (otherwise only the standard 144px version exists). */
  full: boolean;
}

/** Used if metadata can't be read: the column implied by the "cr282_imageid" helper column. */
const FALLBACK_IMAGE: ImageColumn = { column: 'cr282_image', full: false };

type ImageTable = 'trip' | 'destination' | 'place' | 'item';

/** PackList_Item "Type" choice → Packlist category, type and counting. */
export const ITEM_TYPE_MAP: Record<number, { category: ItemCategory; kind: string; countRule: CountRule }> = {
  0: { category: 'Clothing', kind: 'Shirts', countRule: 'trip' },
  1: { category: 'Clothing', kind: 'Pants', countRule: 'trip' },
  2: { category: 'Shoes', kind: 'Shoes', countRule: 'trip' },
  3: { category: 'Clothing', kind: 'Socks', countRule: 'perDay' },
  4: { category: 'Clothing', kind: 'Underwear', countRule: 'perDay' },
  5: { category: 'Clothing', kind: 'Jackets & coats', countRule: 'trip' },
  6: { category: 'Accessories', kind: 'Accessories', countRule: 'trip' },
  7: { category: 'Other', kind: '', countRule: 'trip' },
};

type Json = Record<string, unknown>;

/** Everything read from Dataverse, as plain rows. */
export interface Source {
  trips: Json[];
  destinations: Json[];
  places: Json[];
  activities: Json[];
  items: Json[];
  itemCounts: Json[];
  /** [tripId, destinationId] */
  tripDestinations: [string, string][];
  /** [tripId, itemId] */
  tripItems: [string, string][];
  /** [activityId, itemId] from either Activity⇄Item relationship */
  activityItems: [string, string][];
  /** Each table's image column (null if it has none). Missing in older tests: assume the default. */
  images?: Partial<Record<ImageTable, ImageColumn | null>>;
}

/** Finds a table's image column from metadata (the primary image if there are several). */
async function imageColumn(c: DataverseConfig, table: string, deps: DvDeps): Promise<ImageColumn | null> {
  try {
    const res = await dvGet<{ value: Json[] }>(
      c,
      `EntityDefinitions(LogicalName='${table}')/Attributes/Microsoft.Dynamics.CRM.ImageAttributeMetadata?$select=LogicalName,CanStoreFullImage,IsPrimaryImage`,
      deps,
    );
    const cols = res.value ?? [];
    const pick = cols.find((a) => a.IsPrimaryImage === true) ?? cols[0];
    return pick ? { column: String(pick.LogicalName), full: pick.CanStoreFullImage === true } : null;
  } catch {
    return FALLBACK_IMAGE;
  }
}

/** Marks each row with whether it has an image (its "<column>id" is set). */
function markImages(rows: Json[], img: ImageColumn | null) {
  for (const r of rows) r.__image = img ? !!r[`${img.column}id`] : false;
}

// ---------- fetching ----------

interface NavProps {
  tripDest: string;
  tripItem: string;
  activityItem: string[];
}

/** Finds the navigation-property names of the many-to-many relationships from metadata. */
async function navProps(c: DataverseConfig, deps: DvDeps): Promise<NavProps> {
  const rels = async (table: string) => {
    const def = await dvGet<Json>(
      c,
      `EntityDefinitions(LogicalName='${table}')?$select=LogicalName&$expand=ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName)`,
      deps,
    );
    return ((def.ManyToManyRelationships as Json[]) ?? []).map((r) => {
      const mineIs1 = r.Entity1LogicalName === table;
      return { other: String(mineIs1 ? r.Entity2LogicalName : r.Entity1LogicalName), nav: String(mineIs1 ? r.Entity1NavigationPropertyName : r.Entity2NavigationPropertyName) };
    });
  };
  const tripRels = await rels(T.trip.table);
  const actRels = await rels(T.activity.table);
  const tripDest = tripRels.find((r) => r.other === T.destination.table)?.nav;
  const tripItem = tripRels.find((r) => r.other === T.item.table)?.nav;
  const activityItem = actRels.filter((r) => r.other === T.item.table).map((r) => r.nav);
  if (!tripDest) throw new Error('Couldn’t find the link between PackList_Trip and PackList_Destination in Dataverse.');
  return { tripDest, tripItem: tripItem ?? '', activityItem };
}

const ACTIVE = '$filter=statecode eq 0';

export async function fetchSource(c: DataverseConfig, deps: DvDeps = {}, onProgress?: (msg: string) => void): Promise<Source> {
  const say = onProgress ?? (() => {});
  say('Reading table links…');
  const nav = await navProps(c, deps);

  say('Reading image columns…');
  const images: Record<ImageTable, ImageColumn | null> = {
    trip: await imageColumn(c, T.trip.table, deps),
    destination: await imageColumn(c, T.destination.table, deps),
    place: await imageColumn(c, T.place.table, deps),
    item: await imageColumn(c, T.item.table, deps),
  };
  const imgSel = (t: ImageTable) => (images[t] ? `,${images[t]!.column}id` : '');

  say('Reading trips…');
  const tripExpand = [`${nav.tripDest}($select=${T.destination.id})`, nav.tripItem && `${nav.tripItem}($select=${T.item.id})`].filter(Boolean).join(',');
  const trips = await dvGetAll(c, `${T.trip.set}?$select=${T.trip.id},cr282_title,cr282_description,cr282_start,cr282_end${imgSel('trip')}&${ACTIVE}&$expand=${tripExpand}`, deps);
  say('Reading destinations and places…');
  const destinations = await dvGetAll(c, `${T.destination.set}?$select=${T.destination.id},cr282_title,cr282_description${imgSel('destination')}&${ACTIVE}`, deps);
  const places = await dvGetAll(c, `${T.place.set}?$select=${T.place.id},cr282_title,cr282_description${imgSel('place')},_cr282_packlist_destination_value&${ACTIVE}`, deps);
  say('Reading activities…');
  const actExpand = nav.activityItem.map((n) => `${n}($select=${T.item.id})`).join(',');
  const activities = await dvGetAll(
    c,
    `${T.activity.set}?$select=${T.activity.id},cr282_title,cr282_description,cr282_start,cr282_stop,_cr282_packlist_place_value,_cr282_packlist_trip_value&${ACTIVE}${actExpand ? `&$expand=${actExpand}` : ''}`,
    deps,
  );
  say('Reading items and counts…');
  const items = await dvGetAll(c, `${T.item.set}?$select=${T.item.id},cr282_title,cr282_type${imgSel('item')}&${ACTIVE}`, deps);
  const itemCounts = await dvGetAll(c, `${T.itemCount.set}?$select=cr282_count,cr282_packed,_cr282_item_value,_cr282_trip_value,modifiedon&${ACTIVE}`, deps);

  const pairs = (rows: Json[], idCol: string, navs: string[], otherId: string): [string, string][] =>
    rows.flatMap((r) => navs.flatMap((n) => ((r[n] as Json[]) ?? []).map((o) => [String(r[idCol]), String(o[otherId])] as [string, string])));

  markImages(trips, images.trip);
  markImages(destinations, images.destination);
  markImages(places, images.place);
  markImages(items, images.item);

  return {
    images,
    trips,
    destinations,
    places,
    activities,
    items,
    itemCounts,
    tripDestinations: pairs(trips, T.trip.id, [nav.tripDest], T.destination.id),
    tripItems: nav.tripItem ? pairs(trips, T.trip.id, [nav.tripItem], T.item.id) : [],
    activityItems: pairs(activities, T.activity.id, nav.activityItem, T.item.id),
  };
}

// ---------- planning ----------

export interface PhotoJob {
  table: 'trips' | 'destinations' | 'places' | 'items';
  /** Packlist ids that should get this photo (a destination copied to 2 trips → 2 ids). */
  ids: string[];
  /** Dataverse record, e.g. "cr282_packlist_items(<guid>)". */
  record: string;
  image: ImageColumn;
}

export interface Plan {
  trips: Trip[];
  destinations: Destination[];
  /** One library entry per Dataverse place (shared by its copies on several trips). */
  libraryPlaces: LibraryPlace[];
  places: Place[];
  activities: Activity[];
  items: Item[];
  activityItems: ActivityItem[];
  /** Items linked to a trip in Dataverse but to none of its activities: added to the whole trip. */
  tripItems: TripItem[];
  packStatus: (PackStatus & { count?: number })[];
  photos: PhotoJob[];
  /** Names of the whole-trip items, per trip, for the preview. */
  tripOnlyItems: { trip: string; items: string[] }[];
  warnings: string[];
}

/** A stable UUID from text, so re-importing updates records instead of duplicating them. */
export async function stableId(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  h[6] = (h[6] & 0x0f) | 0x50; // version 5-style
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dataverse date/time → local "YYYY-MM-DDTHH:mm" (UTC values are shown in this device's time zone). */
export function toLocalDateTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00`; // date-only column
  if (/(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null; // time-zone independent
}

function addMinutes(dt: string, mins: number): string {
  const [d, t] = dt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const x = new Date(y, m - 1, day, hh, mm + mins);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** A best guess at the kind of place from its name. */
export function guessPlaceType(name: string): PlaceType {
  const n = name.toLowerCase();
  if (/hotel|resort|\binn\b|motel|lodge|airbnb|hostel|suites?\b|villa|condo/.test(n)) return 'Hotel';
  if (/restaurant|steak|grill|caf[eé]|bistro|diner|kitchen|trattoria|sushi|pizzeria|brasserie|eatery/.test(n)) return 'Restaurant';
  if (/\bbar\b|\bpub\b|lounge|tavern|brewery|winery|club/.test(n)) return 'Bar';
  if (/pool|beach|spa\b/.test(n)) return 'Pool / Beach';
  if (/airport|flight|train|station|terminal|ferry|cruise|port\b/.test(n)) return 'Transport';
  if (/theat(er|re)|arena|stadium|venue|concert|hall\b|casino/.test(n)) return 'Venue';
  if (/museum|gallery|park\b|zoo|aquarium|tour|landmark/.test(n)) return 'Attraction';
  if (/mall|shop|store|market|outlet/.test(n)) return 'Shopping';
  if (/office|conference|convention|hq\b/.test(n)) return 'Office';
  if (/trail|hike|mountain|lake|forest|canyon|national park/.test(n)) return 'Outdoors';
  return 'Other';
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const title = (r: Json, fallback: string) => str(r.cr282_title).trim() || fallback;

/** Turns Dataverse rows into Packlist records. Pure apart from hashing; easy to test. */
export async function buildPlan(src: Source, userId: string, now = Date.now()): Promise<Plan> {
  const warnings: string[] = [];
  const sid = (...parts: string[]) => stableId([userId, ...parts].join(':'));
  const stamp = { createdAt: now, updatedAt: now };

  const destById = new Map(src.destinations.map((d) => [String(d[T.destination.id]), d]));
  const placeById = new Map(src.places.map((p) => [String(p[T.place.id]), p]));
  const itemById = new Map(src.items.map((i) => [String(i[T.item.id]), i]));
  const tripById = new Map(src.trips.map((t) => [String(t[T.trip.id]), t]));

  const tripsOfDest = new Map<string, Set<string>>();
  for (const [t, d] of src.tripDestinations) {
    if (!tripById.has(t) || !destById.has(d)) continue;
    if (!tripsOfDest.has(d)) tripsOfDest.set(d, new Set());
    tripsOfDest.get(d)!.add(t);
  }

  // --- Activities first: they decide which destinations/places each trip needs.
  interface ActPlan { dvId: string; trip: string; place: string | null; start: string; end: string; row: Json }
  const acts: ActPlan[] = [];
  for (const a of src.activities) {
    const dvId = String(a[T.activity.id]);
    const name = title(a, 'Untitled activity');
    const placeId = str(a._cr282_packlist_place_value) || null;
    const place = placeId ? placeById.get(placeId) : undefined;
    let trip = str(a._cr282_packlist_trip_value);
    if (!trip || !tripById.has(trip)) {
      const candidates = [...(tripsOfDest.get(str(place?._cr282_packlist_destination_value)) ?? [])];
      if (candidates.length === 1) trip = candidates[0];
      else {
        warnings.push(`Skipped activity “${name}”: it isn’t linked to a trip${candidates.length > 1 ? ' (its destination is on several trips)' : ''}.`);
        continue;
      }
    }
    const start = toLocalDateTime(a.cr282_start);
    if (!start) {
      warnings.push(`Skipped activity “${name}”: it has no start time.`);
      continue;
    }
    let end = toLocalDateTime(a.cr282_stop);
    if (!end || end < start) end = addMinutes(start, 60);
    acts.push({ dvId, trip, place: place ? placeId : null, start, end, row: a });
  }

  const photoIds = new Map<string, PhotoJob>();
  const imageTable: Record<PhotoJob['table'], ImageTable> = { trips: 'trip', destinations: 'destination', places: 'place', items: 'item' };
  const addPhoto = (table: PhotoJob['table'], set: string, dvId: string, row: Json, id: string) => {
    const image = src.images ? src.images[imageTable[table]] : FALLBACK_IMAGE;
    const has = typeof row.__image === 'boolean' ? row.__image : !!row.cr282_imageid;
    if (!image || !has) return;
    const record = `${set}(${dvId})`;
    if (!photoIds.has(record)) photoIds.set(record, { table, record, image, ids: [] });
    photoIds.get(record)!.ids.push(id);
  };

  // --- Trips (dates widened to fit their activities if needed).
  const trips: Trip[] = [];
  const tripPk = new Map<string, string>();
  for (const t of src.trips) {
    const dvId = String(t[T.trip.id]);
    const name = title(t, 'Untitled trip');
    const mine = acts.filter((a) => a.trip === dvId);
    let startDate = toLocalDateTime(t.cr282_start)?.slice(0, 10) ?? '';
    let endDate = toLocalDateTime(t.cr282_end)?.slice(0, 10) ?? '';
    const first = mine.map((a) => a.start.slice(0, 10)).sort()[0];
    const last = mine.map((a) => a.end.slice(0, 10)).sort().at(-1);
    if (!startDate) startDate = first ?? endDate ?? new Date(now).toISOString().slice(0, 10);
    if (!endDate) endDate = last ?? startDate;
    if (endDate < startDate) endDate = startDate;
    if (first && first < startDate) {
      warnings.push(`Trip “${name}” starts ${startDate} but has an activity on ${first}; moved the start to ${first}.`);
      startDate = first;
    }
    if (last && last > endDate) {
      warnings.push(`Trip “${name}” ends ${endDate} but has an activity on ${last}; moved the end to ${last}.`);
      endDate = last;
    }
    const id = await sid('trip', dvId);
    tripPk.set(dvId, id);
    trips.push({ id, name, description: str(t.cr282_description), startDate, endDate, ...stamp });
    addPhoto('trips', T.trip.set, dvId, t, id);
  }

  // --- Destinations and places, one copy per trip that uses them.
  const destinations: Destination[] = [];
  const places: Place[] = [];
  const libraryPlaces: LibraryPlace[] = [];
  const destPk = new Map<string, string>(); // `${trip}|${dest}` → id
  const placePk = new Map<string, string>(); // `${trip}|${place}` → id
  const UNASSIGNED = '__unassigned__';

  const ensureDest = async (trip: string, dest: string): Promise<string> => {
    const key = `${trip}|${dest}`;
    if (destPk.has(key)) return destPk.get(key)!;
    const id = await sid('destination', dest, trip);
    destPk.set(key, id);
    const row = destById.get(dest);
    destinations.push({
      id,
      tripId: tripPk.get(trip)!,
      name: row ? title(row, 'Untitled destination') : 'Other places',
      description: row ? str(row.cr282_description) : 'Places from Dataverse that aren’t linked to a destination.',
      ...stamp,
    });
    if (row) addPhoto('destinations', T.destination.set, dest, row, id);
    return id;
  };
  const ensurePlace = async (trip: string, place: string | null): Promise<string> => {
    const placeKey = place ?? UNASSIGNED;
    const key = `${trip}|${placeKey}`;
    if (placePk.has(key)) return placePk.get(key)!;
    const row = place ? placeById.get(place) : undefined;
    const destDv = str(row?._cr282_packlist_destination_value);
    const dest = destDv && destById.has(destDv) ? destDv : UNASSIGNED;
    const destinationId = await ensureDest(trip, dest);
    const id = await sid('place', placeKey, trip);
    placePk.set(key, id);
    const name = row ? title(row, 'Untitled place') : 'Unassigned place';
    const details = {
      name,
      description: row ? str(row.cr282_description) : 'Activities from Dataverse that aren’t linked to a place.',
      type: row ? guessPlaceType(name) : ('Other' as PlaceType),
      address: '',
    };
    // Real Dataverse places get one library entry, shared by every trip they're copied into.
    let libraryId: string | undefined;
    if (row && place) {
      libraryId = await sid('libraryPlace', place);
      if (!libraryPlaces.some((l) => l.id === libraryId)) {
        libraryPlaces.push({ id: libraryId, ...details, ...stamp });
        addPhoto('places', T.place.set, place, row, libraryId);
      }
    }
    places.push({ id, tripId: tripPk.get(trip)!, destinationId, libraryId, ...details, ...stamp });
    if (row && place) addPhoto('places', T.place.set, place, row, id);
    return id;
  };

  // Destinations linked to each trip, with all their places (even ones without activities).
  for (const [d, tripSet] of tripsOfDest) {
    for (const t of tripSet) {
      await ensureDest(t, d);
      for (const p of src.places) if (str(p._cr282_packlist_destination_value) === d) await ensurePlace(t, String(p[T.place.id]));
    }
  }

  // --- Activities.
  const activities: Activity[] = [];
  const actPk = new Map<string, { id: string; trip: string }>();
  let unplaced = 0;
  for (const a of acts) {
    if (!a.place) unplaced++;
    const placeId = await ensurePlace(a.trip, a.place);
    const place = places.find((p) => p.id === placeId)!;
    const id = await sid('activity', a.dvId);
    actPk.set(a.dvId, { id, trip: a.trip });
    activities.push({
      id,
      tripId: tripPk.get(a.trip)!,
      destinationId: place.destinationId,
      placeId,
      name: title(a.row, 'Untitled activity'),
      description: str(a.row.cr282_description),
      start: a.start,
      end: a.end,
      ...stamp,
    });
  }
  if (unplaced) warnings.push(`${unplaced} activit${unplaced === 1 ? 'y has' : 'ies have'} no place; put under “Unassigned place”.`);

  // --- Items.
  const items: Item[] = [];
  const itemPk = new Map<string, string>();
  for (const i of src.items) {
    const dvId = String(i[T.item.id]);
    const type = typeof i.cr282_type === 'number' ? ITEM_TYPE_MAP[i.cr282_type] : undefined;
    const m = type ?? { category: 'Other' as ItemCategory, kind: '', countRule: 'trip' as CountRule };
    const id = await sid('item', dvId);
    itemPk.set(dvId, id);
    items.push({ id, name: title(i, 'Untitled item'), description: '', category: m.category, kind: m.kind, countRule: m.countRule, ...stamp });
    addPhoto('items', T.item.set, dvId, i, id);
  }

  // --- Items on activities.
  const activityItems: ActivityItem[] = [];
  const seenLinks = new Set<string>();
  for (const [a, i] of src.activityItems) {
    const act = actPk.get(a);
    const item = itemPk.get(i);
    if (!act || !item || seenLinks.has(`${a}|${i}`)) continue;
    seenLinks.add(`${a}|${i}`);
    activityItems.push({ id: await sid('activityItem', a, i), tripId: tripPk.get(act.trip)!, activityId: act.id, itemId: item, quantity: 1, note: '', createdAt: now });
  }

  // --- Packed ticks and counts (latest row wins if there are duplicates).
  const latest = new Map<string, Json>();
  for (const r of [...src.itemCounts].sort((x, y) => str(x.modifiedon).localeCompare(str(y.modifiedon)))) {
    latest.set(`${str(r._cr282_trip_value)}|${str(r._cr282_item_value)}`, r);
  }
  const packStatus: Plan['packStatus'] = [];
  for (const [key, r] of latest) {
    const [t, i] = key.split('|');
    const trip = tripPk.get(t);
    const item = itemPk.get(i);
    if (!trip || !item) continue;
    const count = typeof r.cr282_count === 'number' && r.cr282_count >= 1 ? r.cr282_count : undefined;
    packStatus.push({ id: `${trip}:${item}`, tripId: trip, itemId: item, packed: r.cr282_packed === true, count });
  }

  // --- Items tied to a trip but to none of its activities become whole-trip items.
  const onActivities = new Set(activityItems.map((l) => `${l.tripId}|${l.itemId}`));
  const tripOnly = new Map<string, Set<string>>();
  const tripItems: TripItem[] = [];
  const addTripOnly = async (t: string, i: string) => {
    const trip = tripPk.get(t);
    const item = itemPk.get(i);
    if (!trip || !item || onActivities.has(`${trip}|${item}`)) return;
    onActivities.add(`${trip}|${item}`); // once per trip
    if (!tripOnly.has(t)) tripOnly.set(t, new Set());
    tripOnly.get(t)!.add(title(itemById.get(i)!, 'Untitled item'));
    tripItems.push({ id: await sid('tripItem', t, i), tripId: trip, itemId: item, quantity: 1, note: '', createdAt: now });
  };
  for (const [t, i] of src.tripItems) await addTripOnly(t, i);
  for (const key of latest.keys()) await addTripOnly(...(key.split('|') as [string, string]));
  const tripOnlyItems = [...tripOnly].map(([t, names]) => ({ trip: title(tripById.get(t)!, 'Untitled trip'), items: [...names].sort() }));

  // The itinerary lists destinations and places in creation order: make that the order you'll
  // visit them (earliest activity first; ones without activities last, by name).
  const firstStart = (pick: (a: Activity) => string) => {
    const m = new Map<string, string>();
    for (const a of activities) {
      const k = pick(a);
      if (!m.has(k) || a.start < m.get(k)!) m.set(k, a.start);
    }
    return m;
  };
  const order = <R extends { id: string; name: string; createdAt: number; updatedAt: number }>(rows: R[], first: Map<string, string>) => {
    rows.sort((x, y) => (first.get(x.id) ?? '\uffff').localeCompare(first.get(y.id) ?? '\uffff') || x.name.localeCompare(y.name));
    rows.forEach((r, i) => {
      r.createdAt = now + i;
      r.updatedAt = now + i;
    });
  };
  order(destinations, firstStart((a) => a.destinationId));
  order(places, firstStart((a) => a.placeId));

  return {
    trips,
    destinations,
    libraryPlaces,
    places,
    activities,
    items,
    activityItems,
    tripItems,
    packStatus,
    photos: [...photoIds.values()],
    tripOnlyItems,
    warnings,
  };
}

// ---------- applying ----------

export interface ApplyResult {
  /** Photos downloaded. */
  photos: number;
  /** Photos that couldn't be downloaded (see firstPhotoError). */
  photoFailures: number;
  /** Records Dataverse said had an image but returned none. */
  photoMissing: number;
  firstPhotoError?: string;
}

/**
 * Downloads one record's image, trying the full-size image (if stored), then the standard
 * image, then the small copy Dataverse returns inline with the record.
 */
export async function downloadImage(c: DataverseConfig, job: PhotoJob, deps?: DvDeps): Promise<Blob | null> {
  const { record, image } = job;
  let lastError: unknown = null;
  const attempts = [
    ...(image.full ? [`${record}/${image.column}/$value?size=full`] : []),
    `${record}/${image.column}/$value`,
  ];
  for (const path of attempts) {
    try {
      const blob = await dvGetBlob(c, path, deps);
      if (blob) return blob;
    } catch (e) {
      lastError = e;
    }
  }
  try {
    const row = await dvGet<Json>(c, `${record}?$select=${image.column}`, deps);
    const b64 = row[image.column];
    if (typeof b64 === 'string' && b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/jpeg' });
    }
  } catch (e) {
    lastError = e;
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * Writes the plan into Packlist (and, through sync, to the user's account). Re-importing
 * updates the same records. A record that has no image in Dataverse keeps any photo it
 * already has in Packlist.
 */
export async function applyPlan(
  c: DataverseConfig,
  plan: Plan,
  opts: { includePhotos: boolean; deps?: DvDeps; onProgress?: (msg: string) => void; resize?: (b: Blob) => Promise<string> },
): Promise<ApplyResult> {
  const say = opts.onProgress ?? (() => {});
  const resize = opts.resize ?? ((b: Blob) => resizeImage(b));
  const photoFor = new Map<string, string>();
  let photos = 0;
  let photoFailures = 0;
  let photoMissing = 0;
  let firstPhotoError: string | undefined;

  if (opts.includePhotos && plan.photos.length) {
    let done = 0;
    const queue = [...plan.photos];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const blob = await downloadImage(c, job, opts.deps);
          if (blob) {
            const dataUrl = await resize(blob);
            for (const id of job.ids) photoFor.set(id, dataUrl);
            photos++;
          } else {
            photoMissing++;
          }
        } catch (e) {
          photoFailures++;
          firstPhotoError ??= (e as Error).message;
        }
        say(`Downloading photos… ${++done} of ${plan.photos.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  say('Saving…');
  const keep = <R extends { id: string; photo?: string; createdAt?: number }>(rows: R[], existing: (R | undefined)[]) =>
    rows.map((r, i) => {
      const old = existing[i];
      const photo = photoFor.get(r.id) ?? old?.photo;
      return { ...r, ...(photo ? { photo } : {}), ...(old?.createdAt ? { createdAt: old.createdAt } : {}) };
    });

  // Places already imported may be linked to a different library entry (for example one the
  // server created when the library was introduced): keep using that one, don't add another.
  const priorPlaces = await db.places.bulkGet(plan.places.map((p) => p.id));
  const libFor = new Map<string, string>();
  plan.places.forEach((p, i) => {
    const prior = priorPlaces[i]?.libraryId;
    if (p.libraryId && prior && prior !== p.libraryId) libFor.set(p.libraryId, prior);
  });
  const libraryPlaces = plan.libraryPlaces.map((l) => ({ ...l, id: libFor.get(l.id) ?? l.id }));
  const places = plan.places.map((p) => (p.libraryId ? { ...p, libraryId: libFor.get(p.libraryId) ?? p.libraryId } : p));
  for (const [from, to] of libFor) if (photoFor.has(from)) photoFor.set(to, photoFor.get(from)!);

  await db.transaction('rw', [db.placeLibrary, db.trips, db.destinations, db.places, db.activities, db.items, db.tripItems, db.activityItems, db.packStatus], async () => {
    // Parents before children, so they reach the server in a valid order.
    await db.trips.bulkPut(keep(plan.trips, await db.trips.bulkGet(plan.trips.map((r) => r.id))));
    await db.destinations.bulkPut(keep(plan.destinations, await db.destinations.bulkGet(plan.destinations.map((r) => r.id))));
    await db.placeLibrary.bulkPut(keep(libraryPlaces, await db.placeLibrary.bulkGet(libraryPlaces.map((r) => r.id))));
    await db.places.bulkPut(keep(places, priorPlaces));
    await db.activities.bulkPut(keep(plan.activities, await db.activities.bulkGet(plan.activities.map((r) => r.id))));
    await db.items.bulkPut(keep(plan.items, await db.items.bulkGet(plan.items.map((r) => r.id))));
    await db.tripItems.bulkPut(plan.tripItems);
    await db.activityItems.bulkPut(plan.activityItems);
    // Counts from Dataverse are applied below; otherwise keep a count set by hand in Packlist.
    const oldStatus = await db.packStatus.bulkGet(plan.packStatus.map((r) => r.id));
    await db.packStatus.bulkPut(
      plan.packStatus.map(({ count, ...s }, i) => ({ ...s, quantity: count ? null : (oldStatus[i]?.quantity ?? null) })),
    );
  });

  // Dataverse counts become manual counts only where they differ from Packlist's automatic count.
  const counted = plan.packStatus.filter((s) => s.count);
  if (counted.length) {
    const overrides: PackStatus[] = [];
    for (const trip of plan.trips) {
      const mine = counted.filter((s) => s.tripId === trip.id);
      if (!mine.length) continue;
      const [destinations, places, activities, activityItems, tripItems, packStatus] = await Promise.all([
        db.destinations.where('tripId').equals(trip.id).toArray(),
        db.places.where('tripId').equals(trip.id).toArray(),
        db.activities.where('tripId').equals(trip.id).toArray(),
        db.activityItems.where('tripId').equals(trip.id).toArray(),
        db.tripItems.where('tripId').equals(trip.id).toArray(),
        db.packStatus.where('tripId').equals(trip.id).toArray(),
      ]);
      const items = (await db.items.bulkGet([...new Set([...activityItems, ...tripItems].map((l) => l.itemId))])).filter((i): i is Item => !!i);
      const auto = new Map(buildPackingList({ trip, destinations, places, activities, activityItems, tripItems, items, packStatus }).map((e) => [e.item.id, e.autoQuantity]));
      for (const s of mine) {
        if (auto.has(s.itemId) && auto.get(s.itemId) !== s.count) overrides.push({ id: s.id, tripId: s.tripId, itemId: s.itemId, packed: s.packed, quantity: s.count! });
      }
    }
    if (overrides.length) await db.packStatus.bulkPut(overrides);
  }
  return { photos, photoFailures, photoMissing, firstPhotoError };
}
