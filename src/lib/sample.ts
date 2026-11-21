import * as repo from './repo';
import { db } from '../db';
import { defaultCountRule } from './counts';
import { shiftYmd, todayYmd } from './dates';
import type { ItemCategory } from '../types';

/** Creates a realistic example trip (Las Vegas → New York) so a new user can see how Packlist works. */
export async function createSampleTrip(): Promise<string> {
  const start = shiftYmd(todayYmd(), 14);
  const day = (n: number, time: string) => `${shiftYmd(start, n)}T${time}`;

  const trip = await repo.createTrip({
    name: 'Vegas & New York',
    description: 'A long weekend in Vegas, then a few days in the city.',
    startDate: start,
    endDate: shiftYmd(start, 5),
  });

  const items = new Map<string, string>();
  const item = async (name: string, category: ItemCategory, description = '') => {
    if (!items.has(name)) {
      // Reuse an existing library item with the same name, so loading the sample twice doesn't duplicate it.
      const existing = await db.items.filter((i) => i.name.toLowerCase() === name.toLowerCase()).first();
      items.set(name, existing?.id ?? (await repo.createItem({ name, category, description, countRule: defaultCountRule(name, category) })).id);
    }
    return items.get(name)!;
  };
  const add = async (activityId: string, list: [string, ItemCategory, number?][]) => {
    for (const [name, cat, qty] of list) await repo.addItemToActivity(activityId, await item(name, cat), qty ?? 1);
  };

  // --- Las Vegas ---
  const vegas = await repo.createDestination(trip.id, { name: 'Las Vegas', description: 'Sun, pools and shows.' });
  const hotel = await repo.createPlace(vegas.id, { name: 'The Grand Resort', type: 'Hotel', address: 'Las Vegas Blvd' });
  const checkIn = await repo.createActivity(hotel.id, { name: 'Check in', start: day(0, '15:00'), end: day(0, '16:00') });
  await add(checkIn.id, [
    ['Passport / ID', 'Documents'],
    ['Phone charger', 'Electronics'],
    ['Toiletry kit', 'Toiletries'],
    ['Comfortable sneakers', 'Shoes'],
    ['Socks', 'Clothing'],
    ['Underwear', 'Clothing'],
  ]);
  const pool = await repo.createPlace(vegas.id, { name: 'Resort pool', type: 'Pool / Beach' });
  const poolTime = await repo.createActivity(pool.id, { name: 'Pool time', start: day(1, '11:00'), end: day(1, '16:00') });
  await add(poolTime.id, [
    ['Swimsuit', 'Swimwear', 2],
    ['Sunscreen SPF 50', 'Toiletries'],
    ['Sunglasses', 'Accessories'],
    ['Flip flops', 'Shoes'],
  ]);
  const steak = await repo.createPlace(vegas.id, { name: 'Prime Steakhouse', type: 'Restaurant', description: 'Business casual dress code.' });
  const dinner = await repo.createActivity(steak.id, { name: 'Dinner', start: day(1, '19:30'), end: day(1, '21:30') });
  await add(dinner.id, [
    ['Navy blazer', 'Clothing'],
    ['White dress shirt', 'Clothing'],
    ['Dress shoes', 'Shoes'],
    ['Watch', 'Accessories'],
  ]);

  // --- New York ---
  const ny = await repo.createDestination(trip.id, { name: 'New York', description: 'Museums, walking and a Broadway show.' });
  const nyHotel = await repo.createPlace(ny.id, { name: 'Midtown Hotel', type: 'Hotel' });
  const nyCheckIn = await repo.createActivity(nyHotel.id, { name: 'Check in', start: day(3, '14:00'), end: day(3, '15:00') });
  await add(nyCheckIn.id, [
    ['Passport / ID', 'Documents'],
    ['Phone charger', 'Electronics'],
    ['Light jacket', 'Clothing'],
  ]);
  const museum = await repo.createPlace(ny.id, { name: 'Art Museum', type: 'Attraction' });
  const visit = await repo.createActivity(museum.id, { name: 'Museum day', start: day(4, '10:00'), end: day(4, '15:00') });
  await add(visit.id, [
    ['Comfortable sneakers', 'Shoes'],
    ['Day backpack', 'Gear'],
    ['Water bottle', 'Gear'],
  ]);
  const theater = await repo.createPlace(ny.id, { name: 'Broadway theater', type: 'Venue' });
  const show = await repo.createActivity(theater.id, { name: 'Evening show', start: day(4, '19:00'), end: day(4, '22:00') });
  await add(show.id, [
    ['Navy blazer', 'Clothing'],
    ['Dress shoes', 'Shoes'],
  ]);

  return trip.id;
}
