import type { Activity, ActivityItem, CountRule, Destination, Item, PackStatus, Place, Trip, TripItem } from '../types';
import { ITEM_CATEGORIES } from '../types';
import { datePart, dayCount, formatDayHeading } from './dates';
import { typeLabel, typeRank } from './itemTypes';

export interface ItemUsage {
  activity: Activity;
  place?: Place;
  destination?: Destination;
  quantity: number;
  note: string;
}

export interface PackingEntry {
  item: Item;
  /** How many to pack on this trip: the manual count if one is set, otherwise `autoQuantity`. */
  quantity: number;
  /** The count worked out from the item's count rule (see CountRule). */
  autoQuantity: number;
  /** True when the count was set by hand for this trip. */
  manual: boolean;
  /** Plain-English explanation of autoQuantity, e.g. "1 per day × 5 days". */
  reason: string;
  usages: ItemUsage[];
  /** Set when the item is also (or only) added to the whole trip rather than an activity. */
  tripLevel?: { id: string; quantity: number; note: string };
  /** Earliest activity start that needs this item ('' if it's only on the whole trip). */
  firstNeeded: string;
  packed: boolean;
}

export interface PackingGroup {
  key: string;
  label: string;
  entries: PackingEntry[];
}

export type GroupBy = 'category' | 'type' | 'destination' | 'day';

export interface PackingInput {
  /** Needed for "one per day" items; without it they fall back to the whole-trip count. */
  trip?: Pick<Trip, 'startDate' | 'endDate'>;
  destinations: Destination[];
  places: Place[];
  activities: Activity[];
  activityItems: ActivityItem[];
  /** Items added to the whole trip rather than one activity. */
  tripItems?: TripItem[];
  items: Item[];
  packStatus: PackStatus[];
}

/** Group key/label for whole-trip items in the Day and Destination views. */
export const WHOLE_TRIP = { key: 'whole-trip', label: 'Whole trip' };

export function buildPackingList(input: PackingInput): PackingEntry[] {
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const actsById = new Map(input.activities.map((a) => [a.id, a]));
  const placesById = new Map(input.places.map((p) => [p.id, p]));
  const destsById = new Map(input.destinations.map((d) => [d.id, d]));
  const status = new Map(input.packStatus.map((s) => [s.itemId, s]));

  const entries = new Map<string, PackingEntry>();
  for (const link of input.activityItems) {
    const item = itemsById.get(link.itemId);
    const activity = actsById.get(link.activityId);
    if (!item || !activity) continue;
    const usage: ItemUsage = {
      activity,
      place: placesById.get(activity.placeId),
      destination: destsById.get(activity.destinationId),
      quantity: link.quantity,
      note: link.note,
    };
    const entry = entries.get(item.id);
    if (entry) {
      entry.usages.push(usage);
      if (activity.start < entry.firstNeeded) entry.firstNeeded = activity.start;
    } else {
      const s = status.get(item.id);
      entries.set(item.id, {
        item,
        quantity: 0,
        autoQuantity: 0,
        manual: false,
        reason: '',
        usages: [usage],
        firstNeeded: activity.start,
        packed: s?.packed ?? false,
      });
    }
  }
  for (const link of input.tripItems ?? []) {
    const item = itemsById.get(link.itemId);
    if (!item) continue;
    const tripLevel = { id: link.id, quantity: link.quantity, note: link.note };
    const entry = entries.get(item.id);
    if (entry) entry.tripLevel = tripLevel;
    else {
      entries.set(item.id, {
        item,
        quantity: 0,
        autoQuantity: 0,
        manual: false,
        reason: '',
        usages: [],
        tripLevel,
        firstNeeded: '',
        packed: status.get(item.id)?.packed ?? false,
      });
    }
  }
  const days = input.trip ? dayCount(input.trip.startDate, input.trip.endDate) : 0;
  for (const e of entries.values()) {
    e.usages.sort((a, b) => a.activity.start.localeCompare(b.activity.start));
    const { count, reason } = autoCount(e.item.countRule ?? 'trip', e.usages, days, e.tripLevel?.quantity);
    e.autoQuantity = count;
    e.reason = reason;
    const manual = status.get(e.item.id)?.quantity;
    e.manual = typeof manual === 'number' && manual >= 1;
    e.quantity = e.manual ? manual! : count;
  }
  return [...entries.values()].sort(byName);
}

/**
 * The automatic count. A whole-trip link counts like one more activity using the item,
 * with its own quantity.
 */
function autoCount(rule: CountRule, usages: ItemUsage[], days: number, tripQty?: number): { count: number; reason: string } {
  const qtys = [...usages.map((u) => u.quantity), ...(tripQty ? [tripQty] : [])];
  const most = Math.max(...qtys);
  const n = usages.length;
  const onlyTrip = n === 0;
  if (rule === 'perDay' && days > 0) {
    return { count: most * days, reason: `${most} per day × ${days} day${days === 1 ? '' : 's'}` };
  }
  if (onlyTrip) return { count: most, reason: 'Added to the whole trip' };
  const what = `${n === 1 ? '1 activity' : `${n} activities`}${tripQty ? ' and the whole trip' : ''}`;
  if (rule === 'perActivity') {
    const total = qtys.reduce((sum, q) => sum + q, 0);
    return { count: total, reason: qtys.length === 1 ? 'Needed by 1 activity' : `Total across ${what}` };
  }
  return {
    count: most,
    reason: qtys.length === 1 ? 'Needed by 1 activity' : `Most needed by any one of ${what} (reused, not multiplied)`,
  };
}

function byName(a: PackingEntry, b: PackingEntry) {
  return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' });
}

export function groupPackingList(
  entries: PackingEntry[],
  groupBy: GroupBy,
  destinations: Destination[] = [],
): PackingGroup[] {
  const groups = new Map<string, PackingGroup>();
  const add = (key: string, label: string, entry: PackingEntry) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, entries: [] };
      groups.set(key, g);
    }
    if (!g.entries.includes(entry)) g.entries.push(entry);
  };

  for (const e of entries) {
    if (groupBy === 'category') {
      add(e.item.category, e.item.category, e);
    } else if (groupBy === 'type') {
      // Untyped items fall back to their category; "Shoes" the type and "Shoes" the category share a group.
      const label = typeLabel(e.item);
      add(label.toLowerCase(), groups.get(label.toLowerCase())?.label ?? label, e);
    } else if (groupBy === 'day') {
      if (e.tripLevel) add(WHOLE_TRIP.key, WHOLE_TRIP.label, e);
      else {
        const day = datePart(e.firstNeeded);
        add(day, `First needed ${formatDayHeading(day)}`, e);
      }
    } else {
      // An item can be needed at several destinations; list it under each (and under Whole trip).
      if (e.tripLevel) add(WHOLE_TRIP.key, WHOLE_TRIP.label, e);
      for (const u of e.usages) {
        const d = u.destination;
        add(d?.id ?? 'unknown', d?.name ?? 'Unknown destination', e);
      }
    }
  }

  const list = [...groups.values()];
  for (const g of list) g.entries.sort(byName);
  const wholeTripFirst = (a: PackingGroup, b: PackingGroup) => Number(b.key === WHOLE_TRIP.key) - Number(a.key === WHOLE_TRIP.key);

  if (groupBy === 'category') {
    const order = ITEM_CATEGORIES as readonly string[];
    list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else if (groupBy === 'type') {
    list.sort((a, b) => {
      const [ra, na] = typeRank(a.label);
      const [rb, nb] = typeRank(b.label);
      return ra - rb || na.localeCompare(nb);
    });
  } else if (groupBy === 'day') {
    list.sort((a, b) => wholeTripFirst(a, b) || a.key.localeCompare(b.key));
  } else {
    // Destinations in the order you'll visit them (by earliest activity), then by name.
    const firstAt = new Map<string, string>();
    for (const e of entries)
      for (const u of e.usages) {
        const k = u.destination?.id ?? 'unknown';
        const cur = firstAt.get(k);
        if (!cur || u.activity.start < cur) firstAt.set(k, u.activity.start);
      }
    const names = new Map(destinations.map((d) => [d.id, d.name]));
    list.sort(
      (a, b) =>
        wholeTripFirst(a, b) ||
        (firstAt.get(a.key) ?? '').localeCompare(firstAt.get(b.key) ?? '') ||
        (names.get(a.key) ?? a.label).localeCompare(names.get(b.key) ?? b.label),
    );
  }
  return list;
}

export function packingProgress(entries: PackingEntry[]) {
  const total = entries.length;
  const packed = entries.filter((e) => e.packed).length;
  return { total, packed, percent: total ? Math.round((packed / total) * 100) : 0 };
}

/** Plain-text checklist suitable for sharing or pasting into notes. */
export function packingListToText(tripName: string, groups: PackingGroup[]): string {
  const lines = [`${tripName} — Packing List`, ''];
  for (const g of groups) {
    lines.push(g.label.toUpperCase());
    for (const e of g.entries) {
      const uses = [...(e.tripLevel ? [WHOLE_TRIP.label] : []), ...new Set(e.usages.map((u) => u.activity.name))].join(', ');
      lines.push(`${e.packed ? '☑' : '☐'} ${e.item.name}${e.quantity > 1 ? ` ×${e.quantity}` : ''} — ${uses}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
