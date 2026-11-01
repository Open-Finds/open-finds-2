import { vi } from 'vitest';

type Row = Record<string, unknown>;
// Query-aware fixture: equality/in filters actually constrain returned records.
export function database(tables: Record<string, Row[]> = {}) {
  const inserted: Row[] = [];
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return query; },
      order: () => query,
      limit: (n: number) => { rows = rows.slice(0, n); return query; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (record: Row) => { inserted.push(record); return { error: null }; },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
    };
    return query;
  });
  return { from, inserted, rpc: vi.fn() };
}
