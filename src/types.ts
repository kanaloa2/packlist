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

export interface Place extends BaseEntity {
  tripId: string;
  destinationId: string;
  type: PlaceType;
  address: string;
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

/** An Item lives in a shared library so it can be selected on any Activity of any Trip. */
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

export interface Item extends BaseEntity {
  category: ItemCategory;
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
