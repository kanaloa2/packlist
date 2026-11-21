/* In-memory stand-in for the parts of supabase-js the sync engine uses. */
type Row = Record<string, unknown>;

const FKS: Record<string, [string, string][]> = {
  destinations: [['trip_id', 'trips']],
  places: [['trip_id', 'trips'], ['destination_id', 'destinations']],
  activities: [['trip_id', 'trips'], ['destination_id', 'destinations'], ['place_id', 'places']],
  activity_items: [['trip_id', 'trips'], ['activity_id', 'activities'], ['item_id', 'items']],
  pack_status: [['trip_id', 'trips'], ['item_id', 'items']],
};

export class FakeSupabase {
  tables = new Map<string, Map<string, Row>>();
  files = new Map<string, Blob>();
  calls: string[] = [];
  /** When set, every request fails as if the network were down. */
  offline = false;

  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  rows(name: string) {
    return [...this.table(name).values()];
  }

  private netError() {
    return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
  }

  private cascade(name: string, id: string) {
    for (const [child, fks] of Object.entries(FKS)) {
      for (const [col, parent] of fks) {
        if (parent !== name) continue;
        for (const r of this.rows(child)) if (r[col] === id) this.deleteRow(child, String(r.id));
      }
    }
  }

  private deleteRow(name: string, id: string) {
    if (this.table(name).delete(id)) this.cascade(name, id);
  }

  from(name: string) {
    return {
      upsert: async (rows: Row[]) => {
        if (this.offline) return this.netError();
        this.calls.push(`upsert ${name} ${rows.length}`);
        for (const r of rows) {
          for (const [col, parent] of FKS[name] ?? []) {
            if (!this.table(parent).has(String(r[col]))) {
              return { data: null, error: { message: `violates foreign key ${col}`, code: '23503' }, status: 409 };
            }
          }
        }
        for (const r of rows) this.table(name).set(String(r.id), { ...r, user_id: 'u1' });
        return { data: null, error: null, status: 201 };
      },
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          if (this.offline) return this.netError();
          this.calls.push(`delete ${name} ${ids.length}`);
          for (const id of ids) this.deleteRow(name, id);
          return { data: null, error: null, status: 204 };
        },
      }),
      select: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            if (this.offline) return this.netError();
            const all = this.rows(name).sort((a, b) => String(a.id).localeCompare(String(b.id)));
            return { data: all.slice(from, to + 1), error: null, status: 200 };
          },
        }),
      }),
    };
  }

  storage = {
    from: (_bucket: string) => ({
      upload: async (path: string, blob: Blob) => {
        if (this.offline) return { data: null, error: { message: 'Failed to fetch' } };
        this.files.set(path, blob);
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        if (this.offline) return { data: null, error: { message: 'Failed to fetch' } };
        const f = this.files.get(path);
        return f ? { data: f, error: null } : { data: null, error: { message: 'Object not found' } };
      },
    }),
  };

  channel() {
    const ch = { on: () => ch, subscribe: () => ch };
    return ch;
  }

  async removeChannel() {
    return 'ok';
  }
}
