import { db, ALL_TABLES, type TableName } from '../db';

export const BACKUP_FORMAT = 'packlist-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<Backup> {
  const data = {} as Record<TableName, unknown[]>;
  await db.transaction('r', [...ALL_TABLES], async () => {
    for (const t of ALL_TABLES) data[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

export function parseBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const b = parsed as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.data !== 'object' || !b.data) {
    throw new Error('That file is not a Packlist backup.');
  }
  if ((b.version ?? 0) > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of Packlist.');
  }
  for (const t of ALL_TABLES) {
    const rows = (b.data as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`Backup table “${t}” is malformed.`);
  }
  return b as Backup;
}

/**
 * Restores a backup. "replace" wipes current data first; "merge" upserts by id
 * (records in the backup win over existing ones with the same id).
 */
export async function importBackup(backup: Backup, mode: 'replace' | 'merge'): Promise<number> {
  let count = 0;
  await db.transaction('rw', [...ALL_TABLES], async () => {
    if (mode === 'replace') for (const t of ALL_TABLES) await db.table(t).clear();
    for (const t of ALL_TABLES) {
      const rows = (backup.data[t] ?? []) as object[];
      if (rows.length) await db.table(t).bulkPut(rows);
      count += rows.length;
    }
  });
  return count;
}
