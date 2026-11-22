import { describe, expect, it } from 'vitest';
import { describeTables, dvGet, listTables, looksRelevant, summaryText } from './api';
import { checkConfig } from './config';

const cfg = { envUrl: 'https://org81670796.crm.dynamics.com/', clientId: '11111111-2222-3333-4444-555555555555', tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const L = (s: string) => ({ UserLocalizedLabel: { Label: s } });

function fakeDataverse(routes: Record<string, unknown>, seen: string[] = []) {
  const fetcher = (async (url: string, init?: RequestInit) => {
    seen.push(url);
    const auth = (init?.headers as Record<string, string>).Authorization;
    if (auth !== 'Bearer t0k') return new Response(JSON.stringify({ error: { message: 'bad token' } }), { status: 401 });
    const path = decodeURIComponent(url.replace('https://org81670796.crm.dynamics.com/api/data/v9.2/', ''));
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: { message: `no route ${path}` } }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, token: 't0k' };
}

describe('dataverse config', () => {
  it('validates environment URL and IDs', () => {
    expect(checkConfig(cfg)).toBeNull();
    expect(checkConfig({ ...cfg, envUrl: 'https://example.com' })).toMatch(/environment URL/);
    expect(checkConfig({ ...cfg, clientId: 'nope' })).toMatch(/client/);
    expect(checkConfig({ ...cfg, tenantId: '' })).toMatch(/tenant/);
  });
});

describe('dataverse api', () => {
  it('sends the OData headers and reports permission problems clearly', async () => {
    await expect(dvGet(cfg, 'WhoAmI', { ...fakeDataverse({}), token: 'wrong' })).rejects.toThrow(/rejected the sign-in/);
    await expect(dvGet(cfg, 'missing', fakeDataverse({}))).rejects.toThrow(/404/);
  });

  it('lists custom tables only and pre-selects the trip-looking ones', async () => {
    const seen: string[] = [];
    const deps = fakeDataverse(
      {
        EntityDefinitions: {
          value: [
            { LogicalName: 'account', EntitySetName: 'accounts', DisplayName: L('Account'), IsCustomEntity: false },
            { LogicalName: 'cr1_trip', EntitySetName: 'cr1_trips', DisplayName: L('Trip'), IsCustomEntity: true },
            { LogicalName: 'cr1_activity', EntitySetName: 'cr1_activities', DisplayName: L('Activity'), IsCustomEntity: true },
            { LogicalName: 'cr1_invoice', EntitySetName: 'cr1_invoices', DisplayName: L('Invoice'), IsCustomEntity: true },
            { LogicalName: 'cr1_activity_item', EntitySetName: 'x', DisplayName: L('x'), IsCustomEntity: true, IsIntersect: true },
          ],
        },
      },
      seen,
    );
    const tables = await listTables(cfg, deps);
    expect(seen[0]).toMatch(/^https:\/\/org81670796\.crm\.dynamics\.com\/api\/data\/v9\.2\/EntityDefinitions/); // trailing slash trimmed
    expect(tables.map((t) => t.logicalName)).toEqual(['cr1_activity', 'cr1_invoice', 'cr1_trip']);
    expect(tables.filter(looksRelevant).map((t) => t.logicalName)).toEqual(['cr1_activity', 'cr1_trip']);
  });

  it('describes columns, lookups, choices and many-to-many links without row data', async () => {
    const deps = fakeDataverse({
      "EntityDefinitions(LogicalName='cr1_activity')/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata": {
        value: [{ LogicalName: 'cr1_placeid', Targets: ['cr1_place'] }],
      },
      "EntityDefinitions(LogicalName='cr1_activity')/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata": {
        value: [{ LogicalName: 'cr1_kind', OptionSet: { Options: [{ Value: 1, Label: L('Dinner') }, { Value: 2, Label: L('Pool') }] } }],
      },
      "EntityDefinitions(LogicalName='cr1_activity')/Attributes": {
        value: [
          { LogicalName: 'cr1_name', AttributeType: 'String', IsCustomAttribute: true, DisplayName: L('Name') },
          { LogicalName: 'cr1_start', AttributeType: 'DateTime', IsCustomAttribute: true, DisplayName: L('Start') },
          { LogicalName: 'cr1_placeid', AttributeType: 'Lookup', IsCustomAttribute: true, DisplayName: L('Place') },
          { LogicalName: 'cr1_placeidname', AttributeType: 'String', IsCustomAttribute: true, AttributeOf: 'cr1_placeid' },
          { LogicalName: 'cr1_kind', AttributeType: 'Picklist', IsCustomAttribute: true, DisplayName: L('Kind') },
          { LogicalName: 'ownerid', AttributeType: 'Owner', IsCustomAttribute: false, DisplayName: L('Owner') },
          { LogicalName: 'createdon', AttributeType: 'DateTime', IsCustomAttribute: false, DisplayName: L('Created On') },
        ],
      },
      "EntityDefinitions(LogicalName='cr1_activity')": {
        PrimaryIdAttribute: 'cr1_activityid',
        PrimaryNameAttribute: 'cr1_name',
        ManyToManyRelationships: [
          { SchemaName: 'cr1_activity_item', Entity1LogicalName: 'cr1_activity', Entity2LogicalName: 'cr1_item', IntersectEntityName: 'cr1_activity_item' },
        ],
      },
      cr1_activities: { '@odata.count': 42, value: [{ cr1_activityid: 'x' }] },
    });
    const [s] = await describeTables(cfg, [{ logicalName: 'cr1_activity', displayName: 'Activity', entitySet: 'cr1_activities', isCustom: true }], deps);
    expect(s.error).toBeUndefined();
    expect(s).toMatchObject({ primaryId: 'cr1_activityid', primaryName: 'cr1_name', rows: 42 });
    expect(s.manyToMany).toEqual([{ with: 'cr1_item', intersect: 'cr1_activity_item', name: 'cr1_activity_item' }]);
    expect(s.columns.map((c) => c.name)).toEqual(['cr1_kind', 'cr1_name', 'cr1_placeid', 'cr1_start', 'createdon']);
    expect(s.columns.find((c) => c.name === 'cr1_placeid')?.targets).toEqual(['cr1_place']);
    expect(s.columns.find((c) => c.name === 'cr1_kind')?.options).toEqual({ 1: 'Dinner', 2: 'Pool' });
    const text = summaryText(cfg.envUrl, [s]);
    expect(text).toContain('"environment": "https://org81670796.crm.dynamics.com"');
    expect(text).not.toContain('"value"'); // no row data in the summary
  });

  it('keeps going when one table fails, noting the error', async () => {
    const [s] = await describeTables(cfg, [{ logicalName: 'cr1_secret', displayName: 'Secret', entitySet: 'cr1_secrets', isCustom: true }], fakeDataverse({}));
    expect(s.error).toMatch(/404/);
  });
});

describe('sign-in errors', async () => {
  const { friendlyAuthError } = await import('./auth');
  it.each([
    [{ errorCode: 'popup_window_error', message: 'x' }, /blocked the sign-in popup/],
    [{ errorCode: 'timed_out', message: 'x' }, /cancelled or took too long/],
    [new Error('AADSTS50011: The redirect URI does not match'), /redirect address isn’t registered/],
    [new Error('AADSTS65001: The user or administrator has not consented'), /admin consent/],
    [new Error('AADSTS700016: Application not found'), /Application \(client\) ID/],
  ])('%#', (err, re) => expect(friendlyAuthError(err)).toMatch(re));
});
