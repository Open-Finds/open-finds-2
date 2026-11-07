import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({ Authorization: 'Bearer qa-only' }) }));
import { fetchDistanceMatrix } from './apiKeys';
afterEach(() => vi.unstubAllGlobals());
describe('routing response mode validation', () => {
  it('never labels a legacy driving response as walking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ distances: [{ durationSeconds: 480 }] })));
    expect(await fetchDistanceMatrix({ lat: -33.8, lon: 151.2 }, [{ address: '1 Test St', lat: -33.8, lon: 151.2 }], 'walking')).toBeNull();
    expect((await fetchDistanceMatrix({ lat: -33.8, lon: 151.2 }, [{ address: '1 Test St', lat: -33.8, lon: 151.2 }]))?.[0].durationSeconds).toBe(480);
  });
  it('uses only validated provider duration and the requested mode', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ mode: 'transit', verifiedCoordinates: true, distances: [{ durationSeconds: -10 }, { durationSeconds: 600 }] }));
    vi.stubGlobal('fetch', fetcher);
    const results = await fetchDistanceMatrix({ lat: -33.8, lon: 151.2 }, ['1 Test St', '2 Test St'], 'transit');
    expect(results?.map((r) => r.durationSeconds)).toEqual([null, 600]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).mode).toBe('transit');
  });
  it('rejects address-only estimates from legacy handlers lacking venue coordinate verification', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ distances: [{ durationSeconds: 480, lat: -33.8, lon: 151.2 }] })));
    expect((await fetchDistanceMatrix({ lat: -33.8, lon: 151.2 }, ['Sydney']))?.[0].durationSeconds).toBeNull();
    expect(await fetchDistanceMatrix('Sydney', [{ address: '1 Test St', lat: -33.8, lon: 151.2 }], 'driving', true)).toBeNull();
  });

});
