import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ routes: vi.fn() }));
vi.mock('./travel', async (load) => ({ ...await load<typeof import('./travel')>(), routedTimes: api.routes }));
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
import { useDiscoveryTravel, useItineraryTravel, useTravelModes } from './useTravel';
import type { PlannerVenue } from './planner';
const venue: PlannerVenue = { id: 'v', name: 'Fixture', address: '1 Test St', lat: -33.9, lon: 151.3, source: 'saved', category: 'food', tags: [], entityKind: 'venue', link: null };
const origin = { lat: -33.8, lon: 151.2 };
beforeEach(() => { vi.useFakeTimers(); api.routes.mockReset(); api.routes.mockResolvedValue([{ durationSeconds: 600, lat: -33.9, lon: 151.3 }]); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('debounced discovery and itinerary routing', () => {
  it('debounces location changes, never requests without origin, and ignores unrelated render/slider changes', async () => {
    const { result, rerender } = renderHook(({ point }) => useDiscoveryTravel('qa', point, [venue], 'driving'), { initialProps: { point: null as typeof origin | null } });
    await act(() => vi.advanceTimersByTimeAsync(1000)); expect(api.routes).not.toHaveBeenCalled();
    rerender({ point: origin });
    await act(() => vi.advanceTimersByTimeAsync(300)); rerender({ point: { ...origin, lat: -34 } });
    await act(() => vi.advanceTimersByTimeAsync(650)); expect(api.routes).toHaveBeenCalledTimes(1);
    expect(api.routes.mock.calls[0][1].lat).toBe(-34); expect(Object.values(result.current.seconds)).toEqual([600]);
    rerender({ point: { ...origin, lat: -34 } }); await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.routes).toHaveBeenCalledTimes(1);
  });
  it('ignores a stale response after the origin changes', async () => {
    let complete!: (v: unknown) => void;
    api.routes.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const { result, rerender } = renderHook(({ point }) => useDiscoveryTravel('qa', point, [venue], 'driving'), { initialProps: { point: origin } });
    await act(() => vi.advanceTimersByTimeAsync(650));
    rerender({ point: { ...origin, lat: -34 } });
    await act(async () => { complete([{ durationSeconds: 999 }]); });
    expect(result.current.seconds).toEqual({});
    await act(() => vi.advanceTimersByTimeAsync(650)); expect(Object.values(result.current.seconds)).toEqual([600]);
  });
  it('calculates consecutive legs after the order settles, independently of discovery limit', async () => {
    const second = { ...venue, id: 'v2', name: 'Second', address: '2 Test St', lat: -34 };
    const { result, rerender } = renderHook(({ stops }) => useItineraryTravel('qa', stops, 'walking'), { initialProps: { stops: [venue, second] } });
    await act(() => vi.advanceTimersByTimeAsync(300)); rerender({ stops: [second, venue] });
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(api.routes).toHaveBeenCalledTimes(1); expect(api.routes.mock.calls[0][1].lat).toBe(-34);
    expect(api.routes.mock.calls[0][3]).toBe('walking'); expect(result.current.legs).toEqual([600]);
  });
  it('exposes only driving for an older endpoint without capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    const { result } = renderHook(() => useTravelModes());
    await act(async () => {}); expect(result.current).toEqual(['driving']);
  });
});

it('never requests routes for an unavailable mode and recalculates both discoveries and legs on mode changes', async () => {
  const second = { ...venue, id: 'second', lat: -34 };
  const { result, rerender } = renderHook(({ mode }) => ({ discovery: useDiscoveryTravel('qa', origin, [venue], mode), itinerary: useItineraryTravel('qa', [venue, second], mode) }), { initialProps: { mode: null as import('./apiKeys').TravelMode | null } });
  await act(() => vi.advanceTimersByTimeAsync(1000)); expect(api.routes).not.toHaveBeenCalled(); expect(result.current.itinerary.busy).toBe(false);
  rerender({ mode: 'walking' }); await act(() => vi.advanceTimersByTimeAsync(1000)); expect(api.routes.mock.calls.map(c => c[3])).toEqual(['walking', 'walking']);
  rerender({ mode: 'transit' }); await act(() => vi.advanceTimersByTimeAsync(1000)); expect(api.routes.mock.calls.slice(2).map(c => c[3])).toEqual(['transit', 'transit']);
});
it('exposes provider-declared modes and fails closed when capabilities cannot be verified', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ modes: ['driving', 'walking', 'transit', 'flying'] }))));
  const first = renderHook(() => useTravelModes()); await act(async () => {}); expect(first.result.current).toEqual(['driving', 'walking', 'transit']); first.unmount();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  const second = renderHook(() => useTravelModes()); await act(async () => {}); expect(second.result.current).toEqual([]);
});
