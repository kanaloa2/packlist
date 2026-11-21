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
export interface Item extends BaseEntity {
  category: ItemCategory;
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
