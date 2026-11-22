import { describe, expect, it } from 'vitest';
import { fromRemote, toRemote } from './mapping';

describe('mapping', () => {
  it('maps fields to snake_case and fills required defaults for older rows', () => {
    const r = toRemote('items', { id: 'i1', name: 'Socks', category: 'Clothing', description: '', createdAt: 1, updatedAt: 2 });
    expect(r).toMatchObject({ id: 'i1', count_rule: 'trip', kind: '', photo: null, created_at: 1, updated_at: 2 });
    expect(r).not.toHaveProperty('user_id');
  });

  it('round-trips a manual pack count, and null means automatic', () => {
    expect(toRemote('packStatus', { id: 't:i', tripId: 't', itemId: 'i', packed: false, quantity: 4 })).toMatchObject({ quantity: 4 });
    expect(toRemote('packStatus', { id: 't:i', tripId: 't', itemId: 'i', packed: false })).toMatchObject({ quantity: null });
    expect(fromRemote('packStatus', { id: 't:i', trip_id: 't', item_id: 'i', packed: true, quantity: null, user_id: 'u' })).toEqual({
      id: 't:i',
      tripId: 't',
      itemId: 'i',
      packed: true,
      quantity: null,
    });
  });
});
