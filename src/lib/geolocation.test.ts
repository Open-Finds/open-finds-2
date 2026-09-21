import { describe, it, expect, vi, afterEach } from 'vitest';
import { locateUser, GeolocationFailure } from './geolocation';

type Outcome = { pos: [number, number] } | { code: number };

/** Scripts getCurrentPosition: one outcome per call, in order. Returns the options each call got. */
function mockGeolocation(...outcomes: Outcome[]) {
  const seen: PositionOptions[] = [];
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail: PositionErrorCallback, opts: PositionOptions) => {
    seen.push(opts);
    const o = outcomes.shift();
    if (!o) throw new Error('unexpected extra geolocation call');
    if ('pos' in o) ok({ coords: { latitude: o.pos[0], longitude: o.pos[1] } } as GeolocationPosition);
    else fail({ code: o.code, message: '' } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return seen;
}

afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});

describe('locateUser', () => {
  it('takes the fast coarse fix when it arrives', async () => {
    const seen = mockGeolocation({ pos: [-37.8, 144.98] });
    await expect(locateUser()).resolves.toEqual({ lat: -37.8, lon: 144.98 });
    expect(seen).toHaveLength(1);
    expect(seen[0].enableHighAccuracy).toBe(false);
  });

  it('retries with high accuracy after a coarse timeout (a phone still getting a GPS fix)', async () => {
    const seen = mockGeolocation({ code: 3 }, { pos: [-37.81, 144.96] });
    await expect(locateUser()).resolves.toEqual({ lat: -37.81, lon: 144.96 });
    expect(seen).toHaveLength(2);
    expect(seen[1].enableHighAccuracy).toBe(true);
    expect(seen[1].timeout).toBeGreaterThan(seen[0].timeout ?? 0);
  });

  it('stops at once when permission is denied', async () => {
    const seen = mockGeolocation({ code: 1 });
    await expect(locateUser()).rejects.toMatchObject({ reason: 'denied' });
    expect(seen).toHaveLength(1);
  });

  it('reports a timeout only after both attempts fail', async () => {
    mockGeolocation({ code: 3 }, { code: 3 });
    const err = await locateUser().catch((e) => e);
    expect(err).toBeInstanceOf(GeolocationFailure);
    expect(err.reason).toBe('timeout');
    expect(err.message).toMatch(/suburb or postcode/);
  });

  it('explains when the device has no geolocation at all', async () => {
    await expect(locateUser()).rejects.toMatchObject({ reason: 'unsupported' });
  });
});
