import { normalizeEnvUrl, type DataverseConfig } from './config';
import { getToken } from './auth';

type Json = Record<string, unknown>;

/** Fetches from the Dataverse Web API. `fetcher` and `token` are injectable for tests. */
export async function dvGet<T = Json>(
  c: DataverseConfig,
  path: string,
  deps: { fetcher?: typeof fetch; token?: string } = {},
): Promise<T> {
  const token = deps.token ?? (await getToken(c));
  const res = await (deps.fetcher ?? fetch)(`${normalizeEnvUrl(c.envUrl)}/api/data/v9.2/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new Error('Dataverse rejected the sign-in. Try signing out and in again.');
    if (res.status === 403) throw new Error(`Your account can’t read this in Dataverse${detail ? `: ${detail}` : '.'}`);
    throw new Error(`Dataverse request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

const label = (l: unknown): string =>
  ((l as { UserLocalizedLabel?: { Label?: string } } | null)?.UserLocalizedLabel?.Label ?? '') as string;

export interface TableInfo {
  logicalName: string;
  displayName: string;
  entitySet: string;
  isCustom: boolean;
}

/** Custom (non-system) tables in the environment — where an app like yours keeps its data. */
export async function listTables(c: DataverseConfig, deps?: Parameters<typeof dvGet>[2]): Promise<TableInfo[]> {
  const res = await dvGet<{ value: Json[] }>(
    c,
    'EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsCustomEntity,IsIntersect',
    deps,
  );
  return res.value
    .filter((t) => t.IsCustomEntity === true && t.IsIntersect !== true)
    .map((t) => ({
      logicalName: String(t.LogicalName),
      displayName: label(t.DisplayName) || String(t.LogicalName),
      entitySet: String(t.EntitySetName),
      isCustom: true,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Tables whose names look like they hold trips, destinations, places, activities or items. */
export function looksRelevant(t: TableInfo): boolean {
  return /trip|destination|place|venue|location|activit|event|item|pack|cloth|gear|outfit/i.test(`${t.displayName} ${t.logicalName}`);
}

export interface ColumnSummary {
  name: string;
  label: string;
  type: string;
  /** For lookups: the table(s) it points to. */
  targets?: string[];
  /** For choice columns: value → label. */
  options?: Record<string, string>;
}

export interface TableSummary {
  table: string;
  label: string;
  entitySet: string;
  primaryId: string;
  primaryName: string;
  rows: number | string;
  columns: ColumnSummary[];
  manyToMany: { with: string; intersect: string; name: string }[];
  error?: string;
}

const KEEP_SYSTEM = new Set(['createdon', 'modifiedon', 'statecode', 'statuscode']);

/**
 * A compact description of the chosen tables (no row data): columns and their types,
 * lookups and what they point to, choice values, and many-to-many links.
 */
export async function describeTables(
  c: DataverseConfig,
  tables: TableInfo[],
  deps?: Parameters<typeof dvGet>[2],
): Promise<TableSummary[]> {
  const out: TableSummary[] = [];
  for (const t of tables) {
    const base = `EntityDefinitions(LogicalName='${t.logicalName}')`;
    const summary: TableSummary = {
      table: t.logicalName,
      label: t.displayName,
      entitySet: t.entitySet,
      primaryId: '',
      primaryName: '',
      rows: '?',
      columns: [],
      manyToMany: [],
    };
    try {
      const def = await dvGet<Json>(
        c,
        `${base}?$select=PrimaryIdAttribute,PrimaryNameAttribute&$expand=ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName)`,
        deps,
      );
      summary.primaryId = String(def.PrimaryIdAttribute ?? '');
      summary.primaryName = String(def.PrimaryNameAttribute ?? '');
      summary.manyToMany = ((def.ManyToManyRelationships as Json[]) ?? []).map((r) => ({
        with: String(r.Entity1LogicalName === t.logicalName ? r.Entity2LogicalName : r.Entity1LogicalName),
        intersect: String(r.IntersectEntityName),
        name: String(r.SchemaName),
      }));

      const attrs = await dvGet<{ value: Json[] }>(
        c,
        `${base}/Attributes?$select=LogicalName,AttributeType,IsCustomAttribute,DisplayName,AttributeOf`,
        deps,
      );
      const lookups = await dvGet<{ value: Json[] }>(
        c,
        `${base}/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets`,
        deps,
      );
      const picklists = await dvGet<{ value: Json[] }>(
        c,
        `${base}/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`,
        deps,
      );
      const targets = new Map(lookups.value.map((l) => [String(l.LogicalName), (l.Targets as string[]) ?? []]));
      const options = new Map(
        picklists.value.map((p) => [
          String(p.LogicalName),
          Object.fromEntries(
            (((p.OptionSet as Json)?.Options as Json[]) ?? []).map((o) => [String(o.Value), label(o.Label)]),
          ),
        ]),
      );
      summary.columns = attrs.value
        .filter((a) => !a.AttributeOf) // skip generated helper columns (e.g. lookup name copies)
        .filter((a) => a.IsCustomAttribute === true || a.LogicalName === summary.primaryName || KEEP_SYSTEM.has(String(a.LogicalName)))
        .map((a) => {
          const name = String(a.LogicalName);
          const col: ColumnSummary = { name, label: label(a.DisplayName), type: String(a.AttributeType) };
          if (targets.has(name)) col.targets = targets.get(name);
          if (options.has(name)) col.options = options.get(name);
          return col;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const count = await dvGet<Json>(c, `${t.entitySet}?$select=${summary.primaryId}&$count=true&$top=1`, deps);
      const n = count['@odata.count'];
      summary.rows = typeof n === 'number' ? (n >= 5000 ? '5000+' : n) : '?';
    } catch (e) {
      summary.error = (e as Error).message;
    }
    out.push(summary);
  }
  return out;
}

/** Plain text a person can paste into a chat or email: structure only, no row data. */
export function summaryText(envUrl: string, tables: TableSummary[]): string {
  return JSON.stringify({ environment: normalizeEnvUrl(envUrl), tables }, null, 1);
}
