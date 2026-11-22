import { describe, expect, it } from 'vitest';
import { reconcileSettings, type SyncedDataverseSettings } from './accountSettings';

const IDS = { envUrl: 'https://org81670796.crm.dynamics.com', clientId: '11111111-2222-4333-8444-555555555555', tenantId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

/** A stand-in for Supabase Auth holding one user's metadata. */
function fakeAuth(meta: Record<string, unknown> = {}, opts: { offline?: boolean } = {}) {
  const state = { meta: { ...meta }, updates: 0 };
  const user = () => ({ id: 'u1', user_metadata: state.meta });
  const auth = {
    getUser: async () => (opts.offline ? { data: { user: null }, error: new Error('Failed to fetch') } : { data: { user: user() }, error: null }),
    getSession: async () => ({ data: { session: { user: user() } }, error: null }),
    updateUser: async ({ data }: { data: Record<string, unknown> }) => {
      if (opts.offline) return { data: { user: null }, error: new Error('Failed to fetch') };
      state.updates++;
      state.meta = { ...state.meta, ...data };
      return { data: { user: user() }, error: null };
    },
  };
  return { auth: auth as unknown as Parameters<typeof reconcileSettings>[1], state };
}

describe('Dataverse settings synced through the account', () => {
  it('uploads IDs entered on this device before syncing existed (the MacBook case)', async () => {
    const { auth, state } = fakeAuth();
    const r = await reconcileSettings({ ...IDS, tableFilter: 'PackList' }, auth);
    expect(r.uploaded).toBe(true);
    expect((state.meta.dataverse as SyncedDataverseSettings).clientId).toBe(IDS.clientId);
    expect((state.meta.dataverse as SyncedDataverseSettings).tableFilter).toBe('PackList');
    expect((state.meta.dataverse as SyncedDataverseSettings).updatedAt).toBeGreaterThan(0);
  });

  it('a new device with nothing entered uses the account’s settings (the iPhone case)', async () => {
    const { auth, state } = fakeAuth({ dataverse: { ...IDS, tableFilter: 'PackList', updatedAt: 5 } });
    const blank = { envUrl: IDS.envUrl, clientId: '', tenantId: '' };
    const r = await reconcileSettings(blank, auth);
    expect(r.settings).toMatchObject({ ...IDS, tableFilter: 'PackList' });
    expect(state.updates).toBe(0); // nothing blank gets uploaded over the good copy
  });

  it('the newest copy wins', async () => {
    const newer = { ...IDS, clientId: '99999999-2222-4333-8444-555555555555', updatedAt: 200 };
    const a = fakeAuth({ dataverse: { ...IDS, updatedAt: 100 } });
    expect((await reconcileSettings(newer, a.auth)).settings?.clientId).toBe(newer.clientId);
    expect((a.state.meta.dataverse as SyncedDataverseSettings).clientId).toBe(newer.clientId);
    const b = fakeAuth({ dataverse: { ...newer } });
    expect((await reconcileSettings({ ...IDS, updatedAt: 100 }, b.auth)).settings?.clientId).toBe(newer.clientId);
  });

  it('works offline: keeps this device’s settings and uploads them later', async () => {
    const { auth } = fakeAuth({}, { offline: true });
    const r = await reconcileSettings({ ...IDS, updatedAt: 1 }, auth);
    expect(r).toMatchObject({ uploaded: false, offline: true });
    expect(r.settings?.clientId).toBe(IDS.clientId);
  });

  it('ignores malformed account data', async () => {
    const { auth } = fakeAuth({ dataverse: { clientId: 42 } });
    expect((await reconcileSettings(null, auth)).settings).toBeNull();
  });
});
