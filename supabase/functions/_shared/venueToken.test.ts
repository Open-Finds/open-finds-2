import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryFromGoogle, signVenueToken, suburbFromGoogle, VENUE_TOKEN_TTL_SECONDS, verifyVenueToken, type StampedPlace,
} from './venueToken';

const env: Record<string, string> = {};
const place: StampedPlace = {
  google_place_id: 'ChIJtestplace01', name: 'Chatime', address: '1 Victoria Ave, Chatswood NSW 2067, Australia',
  suburb: 'Chatswood', lat: -33.79, lon: 151.18, category: 'cafe',
};
const now = Date.UTC(2026, 10, 24);

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-1';
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] ?? '' } });
});

describe('venue stamps', () => {
  it('round-trips Google details for the person it was issued to', async () => {
    const token = await signVenueToken(place, 'user-1', now);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(await verifyVenueToken(token, 'user-1', now + 1000)).toEqual(place);
  });

  it('refuses a stamp issued to someone else', async () => {
    const token = await signVenueToken(place, 'user-1', now);
    expect(await verifyVenueToken(token, 'user-2', now)).toBeNull();
  });

  it('refuses an expired stamp', async () => {
    const token = await signVenueToken(place, 'user-1', now);
    expect(await verifyVenueToken(token, 'user-1', now + VENUE_TOKEN_TTL_SECONDS * 1000)).toBeNull();
  });

  it('refuses a stamp whose details were changed', async () => {
    const token = (await signVenueToken(place, 'user-1', now))!;
    const [body, signature] = token.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
    forged.name = 'Hijacked';
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString('base64url');
    expect(await verifyVenueToken(`${forgedBody}.${signature}`, 'user-1', now)).toBeNull();
  });

  it('refuses a stamp signed with another key', async () => {
    const token = await signVenueToken(place, 'user-1', now);
    env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-2';
    expect(await verifyVenueToken(token, 'user-1', now)).toBeNull();
  });

  it.each([undefined, 42, '', 'a.b.c', 'not-a-token', `${'x'.repeat(5000)}.y`])('refuses malformed input %#', async (input) => {
    expect(await verifyVenueToken(input, 'user-1', now)).toBeNull();
  });

  it('issues and accepts nothing without a key', async () => {
    const token = await signVenueToken(place, 'user-1', now);
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await signVenueToken(place, 'user-1', now)).toBeNull();
    expect(await verifyVenueToken(token, 'user-1', now)).toBeNull();
  });

  it('does not stamp an incomplete place', async () => {
    expect(await signVenueToken({ ...place, google_place_id: 'short' }, 'user-1', now)).toBeNull();
    expect(await signVenueToken({ ...place, lat: 200 }, 'user-1', now)).toBeNull();
  });
});

describe('Google details for the shared venue', () => {
  it.each([
    [['night_club', 'bar'], 'nightlife'],
    [['bar', 'point_of_interest'], 'bar'],
    [['ice_cream_shop', 'food'], 'dessert'],
    [['coffee_shop', 'food'], 'cafe'],
    [['hiking_area'], 'outdoors'],
    [['vietnamese_restaurant', 'restaurant'], 'food'],
    [['bowling_alley'], 'activity'],
    [['point_of_interest', 'establishment'], null],
  ])('maps %j to %s', (types, category) => {
    expect(categoryFromGoogle(types)).toBe(category);
  });

  it('reads the suburb from the address parts', () => {
    expect(suburbFromGoogle([
      { longText: '1', types: ['street_number'] },
      { longText: 'Chatswood', types: ['locality', 'political'] },
    ])).toBe('Chatswood');
    expect(suburbFromGoogle([{ longText: 'Shibuya', types: ['sublocality'] }])).toBe('Shibuya');
    expect(suburbFromGoogle(undefined)).toBeNull();
  });
});
