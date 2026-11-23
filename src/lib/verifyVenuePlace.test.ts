import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyVenuePlace } from './apiKeys';
import { ProviderUnavailableError } from './providerErrors';

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: mocks.headers }));

const input = { name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000', outdoor: false, addressFromSource: true };
const place = { name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000, Australia', lat: -33.8, lon: 151.2, type: 'food' };

beforeEach(() => {
  mocks.headers.mockResolvedValue({ Authorization: 'Bearer token' });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status = 200) => vi.mocked(fetch).mockResolvedValueOnce(Response.json(body, { status }));
const failure = async (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

/**
 * The contract with the deployed resolve-place: a verified venue carries
 * `verified: true` plus name, address and finite coordinates. Everything else
 * that completes normally is "no match"; anything that stops the check running
 * is a provider problem and must not look like a verdict on the venue.
 */
describe('verifyVenuePlace contract', () => {
  it('asks resolve-place to verify and returns the verified place', async () => {
    reply({ ...place, verified: true });
    await expect(verifyVenuePlace(input)).resolves.toMatchObject(place);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/resolve-place$/);
    expect(JSON.parse(String(init?.body))).toEqual({ ...input, verify: true });
  });

  it('sends a Maps link as a link', async () => {
    reply({ ...place, verified: true });
    await verifyVenuePlace({ url: 'https://maps.app.goo.gl/test' });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ url: 'https://maps.app.goo.gl/test', verify: true });
  });

  it('treats an answer without verified: true as no match, even when it has a place', async () => {
    reply(place);
    await expect(verifyVenuePlace(input)).resolves.toBeNull();
  });

  it('treats an empty answer or missing coordinates as no match', async () => {
    reply({ name: null, address: null, lat: null, lon: null });
    reply({ ...place, verified: true, lat: null });
    reply({ ...place, verified: true, address: '' });
    for (let i = 0; i < 3; i++) await expect(verifyVenuePlace(input)).resolves.toBeNull();
  });

  it.each([
    [401, undefined, 'auth'],
    [403, 'synthetic_user_required', 'unavailable'],
    [409, 'duplicate_request', 'duplicate'],
    [409, 'campaign_busy', 'busy'],
    [429, 'budget_exhausted', 'limit'],
    [429, undefined, 'limit'],
    [503, 'staging_providers_disabled', 'unavailable'],
    [502, 'provider_unavailable', 'unavailable'],
    [500, undefined, 'unavailable'],
  ])('reports HTTP %i %s as a provider problem (%s), not as no match', async (status, code, reason) => {
    reply(code ? { error: 'refused', code } : { error: 'refused' }, status);
    const error = await failure(verifyVenuePlace(input));
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toMatchObject({ reason, status, code });
  });

  it('reports a network failure, a timeout and an unreadable answer as unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    for (let i = 0; i < 3; i++) {
      expect(await failure(verifyVenuePlace(input))).toMatchObject({ name: 'ProviderUnavailableError', reason: 'unavailable' });
    }
  });

  it('sends the attempt id with the verification, and nothing extra when there is none', async () => {
    reply({ ...place, verified: true });
    await verifyVenuePlace(input, '44444444-4444-4444-8444-444444444444');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      ...input, verify: true, attempt_id: '44444444-4444-4444-8444-444444444444',
    });
    reply({ ...place, verified: true });
    await verifyVenuePlace(input);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ ...input, verify: true });
  });

  it('reports the testing limit with its wait, and an expired attempt, as typed provider problems', async () => {
    reply({ error: "You've reached the testing limit. Try again in 13 minutes.", code: 'testing_limit', retry_after_seconds: 723 }, 429);
    expect(await failure(verifyVenuePlace(input, 'x'))).toMatchObject({ reason: 'testing_limit', status: 429, retryAfterSeconds: 723 });
    reply({ error: 'This attempt has expired. Start again.', code: 'attempt_expired' }, 410);
    expect(await failure(verifyVenuePlace(input, 'x'))).toMatchObject({ reason: 'attempt_expired', status: 410 });
  });

  it('reports a missing session as a sign-in problem without calling the provider', async () => {
    mocks.headers.mockRejectedValueOnce(new Error('Please sign in to use this feature.'));
    expect(await failure(verifyVenuePlace(input))).toMatchObject({ reason: 'auth' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
