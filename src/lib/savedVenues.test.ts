import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DUPLICATE_VENUE_MESSAGE, insertSavedVenue, supabase, updateSavedVenue } from './supabase';

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** A chainable stand-in for supabase.from('saved_venues'): every step returns itself, the last awaits a result. */
function table(results: Result[]) {
  const calls: string[] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const step of ['insert', 'update', 'select', 'eq', 'ilike', 'order']) {
    chain[step] = (...args: unknown[]) => { calls.push(`${step}:${JSON.stringify(args)}`); return chain; };
  }
  chain.single = () => Promise.resolve(next());
  chain.then = (resolve: (r: Result) => unknown) => Promise.resolve(next()).then(resolve);
  return { chain, calls };
}

const venue = { name: 'Dup Cafe', address: '5 Dup St', type: 'food' as const, link: null, lat: null, lon: null, tags: [] };
const stored = { id: 'v1', user_id: 'u', created_at: '2026-11-01', ...venue, collection: null, visited: false, personal_note: null, rating: null };

beforeEach(() => vi.restoreAllMocks());

describe('saving the same venue twice', () => {
  it('returns the venue the person already has instead of an error', async () => {
    const t = table([
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      { data: [{ ...stored, id: 'older', name: ' dup cafe ' }, stored], error: null },
    ]);
    vi.spyOn(supabase, 'from').mockReturnValue(t.chain as never);
    const saved = await insertSavedVenue({ ...venue, name: 'DUP CAFE' });
    expect(saved.id).toBe('older');
  });

  it('looks the venue up by name and address with wildcards escaped', async () => {
    const t = table([
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: [{ ...stored, name: '100% Pizza_Bar', address: 'A\\B St' }], error: null },
    ]);
    vi.spyOn(supabase, 'from').mockReturnValue(t.chain as never);
    await insertSavedVenue({ ...venue, name: '100% Pizza_Bar', address: 'A\\B St' });
    expect(t.calls).toContain('ilike:["name","100\\\\% Pizza\\\\_Bar"]');
    expect(t.calls).toContain('ilike:["address","A\\\\\\\\B St"]');
  });

  it('says so in plain words if the clashing venue cannot be found', async () => {
    const t = table([
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: [], error: null },
    ]);
    vi.spyOn(supabase, 'from').mockReturnValue(t.chain as never);
    await expect(insertSavedVenue(venue)).rejects.toThrow(DUPLICATE_VENUE_MESSAGE);
  });

  it('still reports other save failures unchanged', async () => {
    const t = table([{ data: null, error: { code: '42501', message: 'permission denied' } }]);
    vi.spyOn(supabase, 'from').mockReturnValue(t.chain as never);
    await expect(insertSavedVenue(venue)).rejects.toMatchObject({ message: 'permission denied' });
  });
});

describe('editing a venue into a duplicate', () => {
  it('explains the clash in plain words', async () => {
    const t = table([{ data: null, error: { code: '23505', message: 'duplicate' } }]);
    vi.spyOn(supabase, 'from').mockReturnValue(t.chain as never);
    await expect(updateSavedVenue('v1', { address: '5 Dup St' })).rejects.toThrow(DUPLICATE_VENUE_MESSAGE);
  });
});
