import { normalizeEnvUrl, type DataverseConfig } from './config';
import { getToken } from './auth';

type Json = Record<string, unknown>;

export interface DvDeps {
  fetcher?: typeof fetch;
  token?: string;
}

async function dvRequest(c: DataverseConfig, pathOrUrl: string, deps: DvDeps, accept: string, prefer: string) {
  const token = deps.token ?? (await getToken(c));
  const base = `${normalizeEnvUrl(c.envUrl)}/api/data/v9.2/`;
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : base + pathOrUrl;
  if (!url.startsWith(base)) throw new Error('Refusing to call a URL outside the Dataverse environment.');
  const res = await (deps.fetcher ?? fetch)(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Prefer: prefer,
    },
  });
  if (!res.ok && res.status !== 204) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new Error('Dataverse rejected the sign-in. Try signing out and in again.');
    if (res.status === 403) throw new Error(`Your account can’t read this in Dataverse${detail ? `: ${detail}` : '.'}`);
    throw Object.assign(new Error(`Dataverse request failed (${res.status})${detail ? `: ${detail}` : ''}`), { status: res.status });
  }
  return res;
}

/** Fetches JSON from the Dataverse Web API. `fetcher` and `token` are injectable for tests. */
export async function dvGet<T = Json>(c: DataverseConfig, path: string, deps: DvDeps = {}): Promise<T> {
  const res = await dvRequest(c, path, deps, 'application/json', 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"');
  return (await res.json()) as T;
}

/** Fetches every row of a query, following Dataverse's paging links. */
export async function dvGetAll(c: DataverseConfig, path: string, deps: DvDeps = {}): Promise<Json[]> {
  const rows: Json[] = [];
  let next: string | undefined = path;
  while (next) {
    const res = await dvRequest(c, next, deps, 'application/json', 'odata.maxpagesize=500');
    const page = (await res.json()) as { value?: Json[]; '@odata.nextLink'?: string };
    rows.push(...(page.value ?? []));
    next = page['@odata.nextLink'];
  }
  return rows;
}

/** Downloads a file/image column; null if the record has none. */
export async function dvGetBlob(c: DataverseConfig, path: string, deps: DvDeps = {}): Promise<Blob | null> {
  try {
    // Image downloads reject a strict Accept header in some environments; take whatever comes.
    const res = await dvRequest(c, path, deps, '*/*', 'return=representation');
    if (res.status === 204) return null;
    const blob = await res.blob();
    return blob.size ? blob : null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
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
export async function listTables(c: DataverseConfig, deps?: DvDeps): Promise<TableInfo[]> {
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

/**
 * True if the table's name starts with `prefix` (case and spaces ignored). Checks the display
 * name ("PackList Trip"), the logical name, and the logical name without its publisher prefix
 * ("cr123_packlisttrip" → "packlisttrip"). An empty prefix matches everything.
 */
export function matchesPrefix(t: TableInfo, prefix: string): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const p = squash(prefix);
  if (!p) return true;
  const logical = t.logicalName.toLowerCase();
  const unprefixed = logical.includes('_') ? logical.slice(logical.indexOf('_') + 1) : logical;
  return squash(t.displayName).startsWith(p) || logical.startsWith(p) || unprefixed.startsWith(p);
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
  deps?: DvDeps,
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
