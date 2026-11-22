import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { checkConfig, type DataverseConfig } from './config';

/**
 * Dataverse connection settings saved to the user's Packlist account (Supabase Auth user
 * metadata), so they're entered once and every signed-in device picks them up. A copy is
 * kept on the device so the panel works offline. The newest copy wins.
 */
export interface SyncedDataverseSettings extends DataverseConfig {
  /** "Table name starts with" filter for the table-details tool. */
  tableFilter?: string;
  /** When these settings were last saved (ms). Missing on settings saved before syncing existed. */
  updatedAt?: number;
}

type Auth = Pick<SupabaseClient['auth'], 'getUser' | 'getSession' | 'updateUser'>;

const META_KEY = 'dataverse';

function fromUser(user: User | null | undefined): SyncedDataverseSettings | null {
  const d = (user?.user_metadata as Record<string, unknown> | undefined)?.[META_KEY] as Partial<SyncedDataverseSettings> | undefined;
  if (!d || typeof d.clientId !== 'string' || typeof d.tenantId !== 'string' || typeof d.envUrl !== 'string') return null;
  return {
    envUrl: d.envUrl,
    clientId: d.clientId,
    tenantId: d.tenantId,
    tableFilter: typeof d.tableFilter === 'string' ? d.tableFilter : undefined,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
  };
}

/** The account's copy: fresh from the server when online, else from the cached session. */
export async function fetchAccountSettings(auth: Auth = supabase.auth): Promise<SyncedDataverseSettings | null> {
  const { data, error } = await auth.getUser();
  if (!error && data.user) return fromUser(data.user);
  const { data: s } = await auth.getSession();
  return fromUser(s.session?.user);
}

export async function saveAccountSettings(settings: SyncedDataverseSettings, auth: Auth = supabase.auth): Promise<void> {
  const { error } = await auth.updateUser({ data: { [META_KEY]: settings } });
  if (error) throw error;
}

/**
 * Decides which settings to use on this device. The account copy wins if it's at least as
 * new as this device's; otherwise this device's valid settings are uploaded (this is how
 * IDs entered on one device before syncing existed reach the others).
 */
export async function reconcileSettings(
  local: SyncedDataverseSettings | null,
  auth: Auth = supabase.auth,
): Promise<{ settings: SyncedDataverseSettings | null; uploaded: boolean; offline: boolean }> {
  let remote: SyncedDataverseSettings | null = null;
  let offline = false;
  try {
    remote = await fetchAccountSettings(auth);
  } catch {
    offline = true;
  }
  const localOk = !!local && checkConfig(local) === null;
  if (remote && (!localOk || (remote.updatedAt ?? 0) >= (local!.updatedAt ?? 0))) {
    return { settings: remote, uploaded: false, offline };
  }
  if (localOk) {
    const stamped = { ...local!, updatedAt: local!.updatedAt || Date.now() };
    try {
      await saveAccountSettings(stamped, auth);
      return { settings: stamped, uploaded: true, offline };
    } catch {
      return { settings: stamped, uploaded: false, offline: true };
    }
  }
  return { settings: remote ?? local, uploaded: false, offline };
}
