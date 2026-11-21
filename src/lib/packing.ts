import type { Activity, ActivityItem, Destination, Item, PackStatus, Place } from '../types';
import { ITEM_CATEGORIES } from '../types';
import { datePart, formatDayHeading } from './dates';

export interface ItemUsage {
  activity: Activity;
  place?: Place;
  destination?: Destination;
  quantity: number;
  note: string;
}

export interface PackingEntry {
  item: Item;
  /**
   * How many to pack. An Item is one specific thing (your black jeans), so reusing it across
   * activities doesn't multiply it — we pack the largest quantity any single activity needs.
   */
  quantity: number;
  usages: ItemUsage[];
  /** Earliest activity start that needs this item. */
  firstNeeded: string;
  packed: boolean;
}

export interface PackingGroup {
  key: string;
  label: string;
  entries: PackingEntry[];
}

export type GroupBy = 'category' | 'destination' | 'day';

export interface PackingInput {
  destinations: Destination[];
  places: Place[];
  activities: Activity[];
  activityItems: ActivityItem[];
  items: Item[];
  packStatus: PackStatus[];
}

export function buildPackingList(input: PackingInput): PackingEntry[] {
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const actsById = new Map(input.activities.map((a) => [a.id, a]));
  const placesById = new Map(input.places.map((p) => [p.id, p]));
  const destsById = new Map(input.destinations.map((d) => [d.id, d]));
  const packed = new Map(input.packStatus.map((s) => [s.itemId, s.packed]));

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
      entry.quantity = Math.max(entry.quantity, link.quantity);
      if (activity.start < entry.firstNeeded) entry.firstNeeded = activity.start;
    } else {
      entries.set(item.id, {
        item,
        quantity: link.quantity,
        usages: [usage],
        firstNeeded: activity.start,
        packed: packed.get(item.id) ?? false,
      });
    }
  }
  for (const e of entries.values()) {
    e.usages.sort((a, b) => a.activity.start.localeCompare(b.activity.start));
  }
  return [...entries.values()].sort(byName);
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
    } else if (groupBy === 'day') {
      const day = datePart(e.firstNeeded);
      add(day, `First needed ${formatDayHeading(day)}`, e);
    } else {
      // An item can be needed at several destinations; list it under each.
      for (const u of e.usages) {
        const d = u.destination;
        add(d?.id ?? 'unknown', d?.name ?? 'Unknown destination', e);
      }
    }
  }

  const list = [...groups.values()];
  for (const g of list) g.entries.sort(byName);

  if (groupBy === 'category') {
    const order = ITEM_CATEGORIES as readonly string[];
    list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else if (groupBy === 'day') {
    list.sort((a, b) => a.key.localeCompare(b.key));
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
      lines.push(`${e.packed ? '☑' : '☐'} ${e.item.name}${e.quantity > 1 ? ` ×${e.quantity}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}
