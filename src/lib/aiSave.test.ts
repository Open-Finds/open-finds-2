import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestSave, identifySharedVenue, publishVenue, readGuestSave, saveSharedVenue, sendRecommendation, sourceUrl } from './aiSave';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), match: vi.fn(), maps: vi.fn(), lookup: vi.fn(), rpc: vi.fn() }));
vi.mock('./openai', () => ({ extractVenuesFromLink: mocks.extract, hasSourceAddress: () => false }));
vi.mock('./apiKeys', () => ({ isGoogleMapsLink: mocks.maps, verifyVenuePlace: mocks.match }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'test-user' } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: mocks.lookup }) }) }) }),
    rpc: mocks.rpc,
  },
}));

const link = 'https://www.instagram.com/reel/test/';
const venue = { name: 'Cafe', address: '1 Test St', type: 'food' as const, link };

afterEach(() => {
  localStorage.clear();
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
      candidates: [candidate], issue: { stage: 'verify', retryable: false },
    });
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
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
    expect(mocks.match).toHaveBeenCalledWith({ url: mapsLink });
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
