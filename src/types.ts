/** Fields every Packlist object shares: a name, a description and an optional photo. */
export interface BaseEntity {
  id: string;
  name: string;
  description: string;
  /** Resized JPEG stored as a data URL, so backups are plain JSON. */
  photo?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trip extends BaseEntity {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

export interface Destination extends BaseEntity {
  tripId: string;
}

export const PLACE_TYPES = [
  'Hotel',
  'Restaurant',
  'Bar',
  'Venue',
  'Attraction',
  'Pool / Beach',
  'Outdoors',
  'Transport',
  'Office',
  'Shopping',
  'Other',
] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/** A place in the user's places library, reusable across trips. */
export interface LibraryPlace extends BaseEntity {
  type: PlaceType;
  address: string;
}

/**
 * A place on a trip, under one of its destinations. Its details are a copy of the linked
 * library place (kept in step when either is edited), so a trip shows correctly even if the
 * library entry is later deleted.
 */
export interface Place extends BaseEntity {
  tripId: string;
  destinationId: string;
  type: PlaceType;
  address: string;
  /** The library place this is an instance of (missing until linked). */
  libraryId?: string;
}

export interface Activity extends BaseEntity {
  tripId: string;
  destinationId: string;
  placeId: string;
  /** YYYY-MM-DDTHH:mm (local time) */
  start: string;
  /** YYYY-MM-DDTHH:mm (local time) */
  end: string;
}

export const ITEM_CATEGORIES = [
  'Clothing',
  'Shoes',
  'Accessories',
  'Swimwear',
  'Toiletries',
  'Medications',
  'Electronics',
  'Documents',
  'Gear',
  'Other',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const COUNT_RULES = ['trip', 'perDay', 'perActivity'] as const;
/**
 * How many of an item a trip's packing list asks for, before any manual change:
 * - trip: the most any single activity needs (an item is one thing you own; reuse doesn't multiply it)
 * - perDay: that many for every day of the trip (socks, underwear)
 * - perActivity: the total across all activities that use it
 */
export type CountRule = (typeof COUNT_RULES)[number];

export const COUNT_RULE_LABELS: Record<CountRule, string> = {
  trip: 'Same for the whole trip',
  perDay: 'One per day of the trip',
  perActivity: 'One per activity',
};

/** Suggested item types; users can also type their own. */
export const ITEM_TYPES = [
  'Shirts',
  'Pants',
  'Shorts',
  'Dresses & skirts',
  'Jackets & coats',
  'Sweaters',
  'Shoes',
  'Socks',
  'Underwear',
  'Sleepwear',
  'Swimwear',
  'Accessories',
  'Hats',
  'Bags',
] as const;

/** An Item lives in a shared library so it can be selected on any Activity of any Trip. */
export interface Item extends BaseEntity {
  category: ItemCategory;
  /** Optional finer type, e.g. "Jackets & coats" or anything the user types. '' or missing = none. */
  kind?: string;
  /** Missing on items created before this existed; treated as 'trip'. */
  countRule?: CountRule;
}

/** Links an Item to an Activity. */
export interface ActivityItem {
  id: string;
  tripId: string;
  activityId: string;
  itemId: string;
  quantity: number;
  note: string;
  createdAt: number;
}

/** Links an Item to a whole Trip rather than one Activity (passport, chargers…). */
export interface TripItem {
  id: string;
  tripId: string;
  itemId: string;
  quantity: number;
  note: string;
  createdAt: number;
}

/** Whether an Item has been packed for a Trip. id = `${tripId}:${itemId}` */
export interface PackStatus {
  id: string;
  tripId: string;
  itemId: string;
  packed: boolean;
  /** Manual count for this trip; undefined/null = use the automatic count. */
  quantity?: number | null;
}

export const PLACE_ICONS: Record<PlaceType, string> = {
  Hotel: '🏨',
  Restaurant: '🍽️',
  Bar: '🍸',
  Venue: '🎭',
  Attraction: '🎡',
  'Pool / Beach': '🏖️',
  Outdoors: '🌲',
  Transport: '✈️',
  Office: '💼',
  Shopping: '🛍️',
  Other: '📍',
};

export const CATEGORY_ICONS: Record<ItemCategory, string> = {
  Clothing: '👕',
  Shoes: '👟',
  Accessories: '🕶️',
  Swimwear: '🩱',
  Toiletries: '🧴',
  Medications: '💊',
  Electronics: '🔌',
  Documents: '🛂',
  Gear: '🎒',
  Other: '📦',
};
