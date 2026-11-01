import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ matrix: vi.fn() }));
vi.mock('./apiKeys', () => ({ fetchDistanceMatrix: api.matrix }));
import { clearTravelCache, journeyLabel, routedTimes, validCoordinate } from './travel';
const origin = { lat: -33.8, lon: 151.2 };
const destinations = Array.from({ length: 27 }, (_, i) => ({ address: `${i} Test Street`, lat: -33.8, lon: 151.2 + i / 10000 }));
beforeEach(() => { clearTravelCache(); api.matrix.mockReset(); api.matrix.mockImplementation(async (_o, ds) => ds.map(() => ({ durationSeconds: 1200, durationText: '20 min' }))); });
describe('real routing cache', () => {
  it('batches at 25, reuses estimates across time thresholds and isolates account/mode/origin', async () => {
    const values = await routedTimes('a', origin, destinations, 'driving');
    expect(values).toHaveLength(27); expect(api.matrix.mock.calls.map((c) => c[1].length)).toEqual([25, 2]);
    await routedTimes('a', origin, destinations, 'driving'); expect(api.matrix).toHaveBeenCalledTimes(2);
    await routedTimes('b', origin, destinations.slice(0, 1), 'driving');
    await routedTimes('a', origin, destinations.slice(0, 1), 'walking');
    await routedTimes('a', { ...origin, lat: -34 }, destinations.slice(0, 1), 'driving');
    expect(api.matrix).toHaveBeenCalledTimes(5);
  });
  it('coalesces duplicate in-flight batches', async () => {
    let finish!: (v: unknown) => void;
    api.matrix.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    const second = routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    finish([{ durationSeconds: 180, durationText: '3 min' }]);
    expect((await first)[0]?.durationSeconds).toBe(180); await second;
    expect(api.matrix).toHaveBeenCalledTimes(1);
  });
  it.each([null, -1, Infinity, NaN])('never invents travel times for unavailable/invalid duration %s', async (seconds) => {
    api.matrix.mockResolvedValue([{ durationSeconds: seconds }]);
    const [result] = await routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    expect(result?.durationSeconds).toBeNull(); expect(result?.error).toBe(true);
  });
  it('retries unavailable results after 30 seconds and successful results after five minutes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    api.matrix.mockResolvedValueOnce(null);
    await routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    now.mockReturnValue(30001); await routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    now.mockReturnValue(330002); await routedTimes('a', origin, destinations.slice(0, 1), 'driving');
    expect(api.matrix).toHaveBeenCalledTimes(3); now.mockRestore();
  });
  it('rejects invalid origins without a provider request', async () => {
    expect(validCoordinate({ lat: 91, lon: 151 })).toBe(false);
    await routedTimes('a', { lat: NaN, lon: 151 }, destinations, 'driving'); expect(api.matrix).not.toHaveBeenCalled();
    expect(journeyLabel(481, 'walking')).toBe('9 min walk');
  });
});
