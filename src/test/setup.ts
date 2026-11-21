import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db, ALL_TABLES } from '../db';

beforeEach(async () => {
  await db.open();
  await db.transaction('rw', [...ALL_TABLES, 'outbox', 'photoCache', 'meta'], async () => {
    for (const t of [...ALL_TABLES, 'outbox', 'photoCache', 'meta']) await db.table(t).clear();
  });
});
