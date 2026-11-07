import { describe, expect, it, vi } from 'vitest';
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
import { rankExistingVenues } from './openai';
describe('AI Finds record validation', () => {
  it('filters invented IDs and duplicates; names/addresses are never taken from the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ids":["real","invented","real"],"name":"Fake venue"}' } }] })));
    expect(await rankExistingVenues([{ id: 'real', name: 'Existing place', address: '1 Real St', category: 'food', tags: [] }], 'date night')).toEqual(['real']);
  });
  it('shows failure rather than fake recommendations when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
    await expect(rankExistingVenues([{ id: 'real', name: 'Existing place', address: '1 Real St', category: 'food', tags: [] }], 'date night')).rejects.toThrow();
  });
});
