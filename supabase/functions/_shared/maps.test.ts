import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ secret: vi.fn() }));
vi.mock('./auth.ts', () => ({
  requireUser: vi.fn(),
  serviceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.secret }) }) }) }),
}));

const STAGING = 'https://crpkzysdtnoomzimibhe.supabase.co';

async function load(env: Record<string, string>, optIn: boolean) {
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] }, serve: vi.fn() });
  if (optIn) {
    const staging = await import('./stagingProviders');
    staging.configureStagingProviders(staging.GEOCODE);
  }
  return import('./maps');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secret.mockResolvedValue({ data: { value: 'table-key' }, error: null });
});

describe('Google Maps key', () => {
  it('is the shared secret everywhere except a staging function that opted in', async () => {
    const production = await load({ SUPABASE_URL: 'https://production.test', GOOGLE_MAPS_API_KEY: 'env-key' }, true);
    await expect(production.getGoogleMapsApiKey()).resolves.toBe('table-key');
    const notOptedIn = await load({ SUPABASE_URL: STAGING, GOOGLE_MAPS_API_KEY: 'env-key' }, false);
    await expect(notOptedIn.getGoogleMapsApiKey()).resolves.toBe('table-key');
  });

  it('is the environment key on a staging function that opted in, and never falls back to the shared table', async () => {
    const env = { SUPABASE_URL: STAGING, STAGING_PROVIDER_ENABLED: 'false' };
    const withKey = await load({ ...env, GOOGLE_MAPS_API_KEY: ' env-key ' }, true);
    await expect(withKey.getGoogleMapsApiKey()).resolves.toBe('env-key');
    const without = await load(env, true);
    await expect(without.getGoogleMapsApiKey()).rejects.toThrow('Staging Google Maps secret not configured');
    expect(mocks.secret).not.toHaveBeenCalled();
  });

  it('still reports a missing shared secret', async () => {
    mocks.secret.mockResolvedValue({ data: null, error: null });
    const production = await load({ SUPABASE_URL: 'https://production.test' }, false);
    await expect(production.getGoogleMapsApiKey()).rejects.toThrow('Google Maps API key not found');
  });
});
