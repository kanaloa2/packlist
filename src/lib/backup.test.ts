import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';
import { exportBackup, importBackup, parseBackup } from './backup';
import { createSampleTrip } from './sample';

describe('backup', () => {
  it('round-trips all data', async () => {
    await createSampleTrip();
    const before = await exportBackup();
    const json = JSON.stringify(before);
    await repo.deleteTrip((await db.trips.toCollection().first())!.id);
    await importBackup(parseBackup(json), 'replace');
    const after = await exportBackup();
    expect(after.data).toEqual(before.data);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a Packlist backup/);
  });

  it('sample trip can be loaded twice without duplicating library items', async () => {
    await createSampleTrip();
    const n = await db.items.count();
    await createSampleTrip();
    expect(await db.items.count()).toBe(n);
    expect(await db.trips.count()).toBe(2);
  });
});
