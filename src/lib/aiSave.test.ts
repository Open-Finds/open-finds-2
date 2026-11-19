import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestSave, identifySharedVenue, publishVenue, readGuestSave, saveSharedVenue, sendRecommendation, sourceUrl } from './aiSave';
import { ProviderUnavailableError } from './providerErrors';

const mocks = vi.hoisted(() => ({
  extract: vi.fn(), match: vi.fn(), maps: vi.fn(), lookup: vi.fn(), rpc: vi.fn(), session: { id: 'test-user' },
}));
vi.mock('./openai', () => ({ extractVenuesFromLink: mocks.extract, hasSourceAddress: () => false }));
vi.mock('./apiKeys', () => ({
  isGoogleMapsLink: mocks.maps,
  verifyVenuePlaceDetailed: async (...args: unknown[]) => ({ match: await mocks.match(...args), candidates: [] }),
}));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.session.id } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: mocks.lookup }) }) }) }),
    rpc: mocks.rpc,
  },
}));

const link = 'https://www.instagram.com/reel/test/';
const venue = { name: 'Cafe', address: '1 Test St', type: 'food' as const, link };

afterEach(() => {
  localStorage.clear();
  mocks.session.id = 'test-user';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('share venue persistence', () => {
  it('strips reel tracking but preserves a non-social query that identifies a place', () => {
    expect(sourceUrl(link + '?igsh=token')).toBe(link);
    expect(sourceUrl('https://maps.google.com/?cid=12#fragment')).toBe('https://maps.google.com/?cid=12');
    expect(() => sourceUrl('https://user:secret@example.com')).toThrow();
  });

  it('reuses an existing saved choice for the exact link without calling providers or writing', async () => {
    const row = { ...venue, id: 'existing' };
    mocks.lookup.mockResolvedValue({ data: [row], error: null });
    await expect(identifySharedVenue(link + '?igsh=test')).resolves.toMatchObject({ saved: row });
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns the corroborated venue and waits for an explicit save', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockResolvedValue({ ...venue, address: '1 Test St, Australia', lat: 1, lon: 2 });
    const row = { ...venue, id: 'persisted' };
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await identifySharedVenue(link);
    expect(result.venue).toMatchObject({ address: '1 Test St, Australia', lat: 1, lon: 2 });
    expect(result.candidates).toMatchObject([{ address: '1 Test St' }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(saveSharedVenue(result.venue!, link)).resolves.toEqual(row);
    expect(mocks.rpc).toHaveBeenCalledWith('save_shared_venue', {
      p_venue: expect.objectContaining({ link, lat: 1, lon: 2 }),
    });
  });

  it('does not save ambiguous, missing, or unverified addresses', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValueOnce([venue, { ...venue, name: 'Other' }])
      .mockResolvedValueOnce([{ ...venue, address: '' }]).mockResolvedValueOnce([venue]);
    mocks.match.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) await expect(identifySharedVenue(link)).resolves.not.toHaveProperty('saved');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('leaves source conflicts and ambiguous captions for manual correction', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    const candidate = { ...venue, requiresManualCorrection: true };
    mocks.extract.mockResolvedValue([candidate]);
    await expect(identifySharedVenue(link)).resolves.toEqual({
      candidates: [candidate], issue: { stage: 'verify', retryable: false, reason: 'needs_review' },
    });
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('asks for review, without calling Google, when there are several candidates', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue, { ...venue, name: 'Other' }]);
    const result = await identifySharedVenue(link);
    expect(result.issue).toEqual({ stage: 'verify', retryable: false, reason: 'needs_review' });
    expect(result.candidates).toHaveLength(2);
    expect(mocks.match).not.toHaveBeenCalled();
  });

  it('reports a Google answer that matched nothing as no match', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockResolvedValue(null);
    await expect(identifySharedVenue(link)).resolves.toMatchObject({
      issue: { stage: 'verify', retryable: false, reason: 'no_match' },
    });
  });

  it.each(['auth', 'busy', 'limit', 'unavailable'] as const)(
    'reports a %s provider problem during verification as retryable, never as no match', async (reason) => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([venue]);
      mocks.match.mockRejectedValue(new ProviderUnavailableError(reason, 503));
      const result = await identifySharedVenue(link);
      expect(result.issue).toMatchObject({ stage: 'verify', retryable: true, reason });
      expect(result.candidates).toEqual([venue]);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

  it('does not offer a retry for an exact request the backend already saw', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockRejectedValue(new ProviderUnavailableError('duplicate', 409, 'duplicate_request'));
    await expect(identifySharedVenue(link)).resolves.toMatchObject({
      issue: { stage: 'verify', retryable: false, reason: 'duplicate' },
    });
  });

  it('reports a provider problem during identification as a service problem, not a missing venue', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockRejectedValueOnce(new ProviderUnavailableError('limit', 429, 'budget_exhausted'));
    await expect(identifySharedVenue(link)).resolves.toMatchObject({
      candidates: [], issue: { stage: 'identify', retryable: true, reason: 'limit' },
    });
    mocks.extract.mockResolvedValueOnce([]);
    const none = await identifySharedVenue(link);
    expect(none.issue).toEqual({ stage: 'identify', retryable: true });
  });

  it('reuses identification after a verification failure, and reuses verification after a write failure', async () => {
    const progress = {};
    const row = { ...venue, id: 'persisted' };
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockRejectedValueOnce(new Error('Places unavailable'))
      .mockResolvedValueOnce({ ...venue, lat: 1, lon: 2 });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('Write failed') })
      .mockResolvedValueOnce({ data: row, error: null });

    await expect(identifySharedVenue(link, progress)).resolves.toMatchObject({ candidates: [venue], issue: { stage: 'verify' } });
    const { venue: verified } = await identifySharedVenue(link, progress);
    expect(verified).toMatchObject({ ...venue, lat: 1, lon: 2 });
    await expect(saveSharedVenue(verified!, link)).rejects.toThrow('Write failed');
    await expect(saveSharedVenue(verified!, link)).resolves.toEqual(row);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.extract).toHaveBeenCalledOnce();
    expect(mocks.match).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });

  it('uses a Maps link directly and reports a failed identification separately', async () => {
    const mapsLink = 'https://maps.app.goo.gl/test';
    mocks.maps.mockReturnValueOnce(true);
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.match.mockResolvedValue(null);
    await expect(identifySharedVenue(mapsLink)).resolves.toMatchObject({ issue: { stage: 'verify' } });
    expect(mocks.match).toHaveBeenCalledWith({ url: mapsLink }, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(mocks.extract).not.toHaveBeenCalled();

    mocks.extract.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(identifySharedVenue(link)).resolves.toMatchObject({ issue: { stage: 'identify' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('links a staging recommendation to the staging guest route', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
    vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', 'https://staging.example.test');
    mocks.rpc.mockResolvedValue({ data: 'recommendation-id', error: null });

    const details = { ...venue, lat: 1, lon: 2, personal_note: 'private' };
    await expect(publishVenue(details))
      .resolves.toBe('https://staging.example.test/venue/recommendation-id');
    expect(mocks.rpc).toHaveBeenCalledWith('publish_standalone_venue_recommendation', { p_venue: venue });
  });

  it('fails before publishing when a staging URL is missing or points to production', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
    vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', '');
    await expect(publishVenue(venue)).rejects.toThrow('Public recommendation URL is unavailable');
    vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', 'https://www.theunsaved.app');
    await expect(publishVenue(venue)).rejects.toThrow('Public recommendation URL is unavailable');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('persists guest saves and overwrites the same recommendation key', () => {
    guestSave('public-id', venue);
    guestSave('public-id', { ...venue, name: 'Updated Cafe' });
    expect(localStorage.length).toBe(1);
    expect(readGuestSave('public-id')?.name).toBe('Updated Cafe');
  });

  it('does not copy when the system share sheet is cancelled', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true, value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
    });
    try {
      await expect(sendRecommendation('Try this', 'https://example.com/v/test')).resolves.toBe('cancelled');

    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
  });
});

/**
 * One AI Save attempt is one id, sent with every request it makes, so the
 * server counts it once however many functions it calls. It survives retries
 * and an accidental close, and ends when the venue is saved.
 */
describe('AI Save attempt ids', () => {
  const other = 'https://www.tiktok.com/@user/video/123';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ready = () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockResolvedValue({ ...venue, lat: 1, lon: 2 });
  };
  const idsUsed = () => [
    ...mocks.extract.mock.calls.map(([, options]) => options?.attemptId),
    ...mocks.match.mock.calls.map(([, attemptId]) => attemptId),
  ];

  it('uses one id for the extraction and the verification of an attempt', async () => {
    ready();
    const progress: Record<string, unknown> = {};
    await identifySharedVenue(link, progress);
    const [id, second] = idsUsed();
    expect(id).toMatch(uuid);
    expect(second).toBe(id);
    expect(progress.attemptId).toBe(id);
  });

  it('keeps the id when the same attempt is retried', async () => {
    ready();
    mocks.match.mockRejectedValueOnce(new ProviderUnavailableError('unavailable', 503)).mockResolvedValue({ ...venue, lat: 1, lon: 2 });
    const progress = {};
    await identifySharedVenue(link, progress);
    await identifySharedVenue(link, progress);
    expect(new Set(idsUsed()).size).toBe(1);
  });

  it('keeps the id after an accidental close: reopening the same link continues the attempt', async () => {
    ready();
    await identifySharedVenue(link, {});
    await identifySharedVenue(link, {});
    expect(mocks.extract).toHaveBeenCalledTimes(2);
    expect(new Set(idsUsed()).size).toBe(1);
  });

  it('starts a new attempt for a different link, and for a different account', async () => {
    ready();
    await identifySharedVenue(link, {});
    await identifySharedVenue(other, {});
    mocks.session.id = 'someone-else';
    await identifySharedVenue(link, {});
    expect(new Set(idsUsed()).size).toBe(3);
  });

  it('ends the attempt when the venue is saved, so the next intentional save is a new one', async () => {
    ready();
    mocks.rpc.mockResolvedValue({ data: { ...venue, id: 'saved' }, error: null });
    const first = {};
    const { venue: verified } = await identifySharedVenue(link, first);
    await saveSharedVenue(verified!, link);
    await identifySharedVenue(link, {});
    const ids = idsUsed();
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[ids.length - 1]);
  });

  it('keeps the attempt when a save fails, so the retry is the same attempt', async () => {
    ready();
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Write failed') });
    const { venue: verified } = await identifySharedVenue(link, {});
    await expect(saveSharedVenue(verified!, link)).rejects.toThrow('Write failed');
    await identifySharedVenue(link, {});
    expect(new Set(idsUsed()).size).toBe(1);
  });

  it('does not reuse an id once it is nearly as old as the server will accept', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    ready();
    await identifySharedVenue(link, {});
    vi.setSystemTime(new Date('2026-11-17T10:24:00Z'));
    await identifySharedVenue(link, {});
    expect(new Set(idsUsed()).size).toBe(1);
    vi.setSystemTime(new Date('2026-11-17T10:26:00Z'));
    await identifySharedVenue(link, {});
    expect(new Set(idsUsed()).size).toBe(2);
  });

  it.each(['attempt_expired', 'attempt_limit'] as const)('drops the id when the server says %s, so the retry is a new attempt', async (reason) => {
    ready();
    mocks.match.mockRejectedValueOnce(new ProviderUnavailableError(reason, 410, reason)).mockResolvedValue({ ...venue, lat: 1, lon: 2 });
    const progress = {};
    const refused = await identifySharedVenue(link, progress);
    expect(refused.issue).toMatchObject({ stage: 'verify', retryable: true, reason });
    await identifySharedVenue(link, progress);
    const ids = idsUsed();
    expect(new Set(ids).size).toBe(2);
    expect(ids[ids.length - 1]).not.toBe(ids[0]);
  });

  it('reports the testing limit with the wait, keeps the id, and keeps the retry available', async () => {
    ready();
    mocks.match.mockRejectedValueOnce(new ProviderUnavailableError('testing_limit', 429, 'testing_limit', undefined, 723));
    const progress = {};
    const refused = await identifySharedVenue(link, progress);
    expect(refused.issue).toMatchObject({ stage: 'verify', retryable: true, reason: 'testing_limit', retryAfterSeconds: 723 });
    expect(refused.candidates).toEqual([venue]);
    mocks.match.mockResolvedValue({ ...venue, lat: 1, lon: 2 });
    await identifySharedVenue(link, progress);
    expect(new Set(idsUsed()).size).toBe(1);
  });

  it('still works when browser storage is unavailable, with one id for the dialog', async () => {
    ready();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const progress = {};
    await identifySharedVenue(link, progress);
    await identifySharedVenue(link, progress);
    expect(idsUsed()[0]).toMatch(uuid);
    expect(new Set(idsUsed()).size).toBe(1);
  });

  it('sends no id for a saved link, because no provider is called', async () => {
    mocks.lookup.mockResolvedValue({ data: [{ ...venue, id: 'existing' }], error: null });
    await identifySharedVenue(link, {});
    expect(idsUsed()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });
});
