import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestSave, identifySharedVenue, publishVenue, readGuestSave, saveSharedVenue, sendRecommendation, sendRecommendationLink, sendRecommendationMessage, sourceUrl } from './aiSave';
import { ProviderUnavailableError } from './providerErrors';

const mocks = vi.hoisted(() => ({
  extract: vi.fn(), match: vi.fn(), maps: vi.fn(), lookup: vi.fn(), rpc: vi.fn(), updateTags: vi.fn(), session: { id: 'test-user' },
  /** Which names the post itself mentions (by default, all of them). */
  mentioned: { names: null as string[] | null },
}));
vi.mock('./openai', () => ({
  extractVenuesFromLink: mocks.extract, hasSourceAddress: () => false,
  mentionedInSource: (_progress: unknown, ...names: string[]) => !mocks.mentioned.names || names.some(name => mocks.mentioned.names!.includes(name)),
}));
vi.mock('./apiKeys', () => ({
  isGoogleMapsLink: mocks.maps,
  verifyVenuePlaceDetailed: async (...args: unknown[]) => ({ match: await mocks.match(...args), candidates: [] }),
}));
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({ Authorization: 'Bearer session' }) }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.session.id } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: mocks.lookup }) }) }) }),
    rpc: mocks.rpc,
  },
  updateSavedVenue: mocks.updateTags,
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

describe('tags saved with a venue', () => {
  const row = { ...venue, id: 'persisted', tags: null as string[] | null };

  it('adds the tags AI Save read after the save, so a search for them finds the venue', async () => {
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    mocks.updateTags.mockResolvedValue({ ...row, tags: ['pizza', 'dessert'] });
    const saved = await saveSharedVenue({ ...venue, tags: ['pizza', 'dessert'] }, link);
    expect(mocks.rpc.mock.calls[0][1].p_venue).not.toHaveProperty('tags');
    expect(mocks.updateTags).toHaveBeenCalledWith('persisted', { tags: ['pizza', 'dessert'] });
    expect(saved.tags).toEqual(['pizza', 'dessert']);
  });

  it('adds only the tags the saved venue does not already have', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, tags: ['Pizza'] }, error: null });
    mocks.updateTags.mockResolvedValue({ ...row, tags: ['Pizza', 'vegan'] });
    await saveSharedVenue({ ...venue, tags: ['pizza', 'vegan'] }, link);
    expect(mocks.updateTags).toHaveBeenCalledWith('persisted', { tags: ['Pizza', 'vegan'] });
    mocks.updateTags.mockClear();
    mocks.rpc.mockResolvedValue({ data: { ...row, tags: ['pizza'] }, error: null });
    await saveSharedVenue({ ...venue, tags: ['pizza'] }, link);
    await saveSharedVenue(venue, link);
    expect(mocks.updateTags).not.toHaveBeenCalled();
  });

  it('still saves the venue when its tags cannot be added', async () => {
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    mocks.updateTags.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveSharedVenue({ ...venue, tags: ['pizza'] }, link)).resolves.toEqual(row);
  });
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

  it('marks a Google-confirmed venue the post never names, and leaves a named one unmarked', async () => {
    mocks.lookup.mockResolvedValue({ data: [], error: null });
    mocks.extract.mockResolvedValue([{ ...venue, name: 'Oyama Ramen' }]);
    mocks.match.mockResolvedValue({ ...venue, name: 'Oyama Ramen', address: '363 Anzac Parade, Kingsford NSW 2032', lat: 1, lon: 2 });
    mocks.mentioned.names = ['Ocean Royale'];
    try {
      const guessed = await identifySharedVenue(link);
      expect(guessed.venue).toMatchObject({ name: 'Oyama Ramen', lat: 1, mentioned: false });
      mocks.mentioned.names = ['Oyama Ramen'];
      const named = await identifySharedVenue(link + '?again');
      expect(named.venue?.mentioned).toBeUndefined();
    } finally {
      mocks.mentioned.names = null;
    }
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

  describe('the cheap AI first, the AI with web search only when needed', () => {
    const real = { ...venue, name: 'Real Cafe', address: '9 Real St, Sydney NSW 2000' };
    const searches = () => mocks.extract.mock.calls.map(([, options]) => options.search);

    it('asks the plain AI first and does not search the web when Google confirms', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([venue]);
      mocks.match.mockResolvedValue({ ...venue, lat: 1, lon: 2 });
      await identifySharedVenue(link);
      expect(searches()).toEqual([false]);
    });

    it('asks the AI with web search when the plain AI found nothing to look up', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValueOnce([{ ...venue, address: '' }]).mockResolvedValueOnce([venue]);
      mocks.match.mockResolvedValue({ ...venue, lat: 1, lon: 2 });
      const result = await identifySharedVenue(link);
      expect(searches()).toEqual([false, true]);
      expect(result.venue).toBeDefined();
    });

    it('searches the web once when Google cannot match the plain answer, then checks Google again', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValueOnce([venue]).mockResolvedValueOnce([real]);
      mocks.match.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...real, lat: 1, lon: 2 });
      const progress = {};
      const result = await identifySharedVenue(link, progress);
      expect(searches()).toEqual([false, true]);
      expect(mocks.match).toHaveBeenCalledTimes(2);
      expect(result.venue).toMatchObject({ name: 'Real Cafe' });
      expect(progress).toMatchObject({ searched: true });
    });

    it('never searches a second time, and offers Google choices when nothing matches', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValueOnce([venue]).mockResolvedValueOnce([real]);
      mocks.match.mockResolvedValue(null);
      const progress = {};
      const result = await identifySharedVenue(link, progress);
      expect(searches()).toEqual([false, true]);
      expect(result.issue).toMatchObject({ reason: 'no_match' });
      mocks.extract.mockClear();
      await identifySharedVenue(link, { ...progress, candidates: [{ ...venue, order: 1, tags: [] }] });
      expect(mocks.extract).not.toHaveBeenCalled();
    });

    it('does not send the same answer to Google twice', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([venue]);
      mocks.match.mockResolvedValue(null);
      await identifySharedVenue(link);
      expect(searches()).toEqual([false, true]);
      expect(mocks.match).toHaveBeenCalledOnce();
    });

    it('never replaces details the user corrected', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.match.mockResolvedValue(null);
      await identifySharedVenue(link, { checkedSaved: true, candidates: [{ ...venue, order: 1, tags: [] }] });
      expect(mocks.extract).not.toHaveBeenCalled();
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

  describe('a post that names several venues', () => {
    const item = (name: string, address = '1 Test St, Sydney NSW 2000') => ({ ...venue, name, address, order: 1, tags: ['pizza'] });

    it('checks every venue with Google and returns one row each, confirmed or not', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([item('A'), item('B'), item('C')]);
      mocks.match.mockImplementation(async (details: { name: string }) =>
        details.name === 'B' ? null : { name: details.name + ' (Google)', address: '2 Real St', type: 'food', lat: 1, lon: 2 });
      const result = await identifySharedVenue(link);
      expect(result.issue).toBeUndefined();
      expect(result.rows?.map(row => [row.venue.name, row.verified])).toEqual([['A (Google)', true], ['B', false], ['C (Google)', true]]);
      expect(result.rows?.[0].venue).toMatchObject({ address: '2 Real St', lat: 1, lon: 2, link, tags: ['pizza'] });
      expect(result.rows?.[1].venue).toMatchObject({ address: '1 Test St, Sydney NSW 2000', lat: null, lon: null });
      expect(mocks.match).toHaveBeenCalledTimes(3);
    });

    it('marks each row the post never names, confirmed by Google or not', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([item('Ame'), item('The Palace')]);
      mocks.match.mockImplementation(async (details: { name: string }) => ({ name: details.name, address: '2 Real St', type: 'food', lat: 1, lon: 2 }));
      mocks.mentioned.names = ['The Palace'];
      try {
        const result = await identifySharedVenue(link);
        expect(result.rows?.map(row => [row.venue.name, row.verified, row.mentioned])).toEqual([['Ame', true, false], ['The Palace', true, undefined]]);
      } finally {
        mocks.mentioned.names = null;
      }
    });

    it('takes at most five venues', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(name => item(name)));
      mocks.match.mockResolvedValue(null);
      const result = await identifySharedVenue(link);
      expect(result.rows).toHaveLength(5);
      expect(mocks.match).toHaveBeenCalledTimes(5);
    });

    it('keeps a venue with no address as an unconfirmed row without asking Google', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([item('A'), item('B', '')]);
      mocks.match.mockResolvedValue({ name: 'A', address: '1 Test St', type: 'food', lat: 1, lon: 2 });
      const result = await identifySharedVenue(link);
      expect(result.rows?.map(row => row.verified)).toEqual([true, false]);
      expect(mocks.match).toHaveBeenCalledOnce();
    });

    it('keeps the venues that were checked when one check fails, and reports a service problem only if all fail', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([item('A'), item('B')]);
      mocks.match.mockRejectedValueOnce(new ProviderUnavailableError('unavailable', 503))
        .mockResolvedValueOnce({ name: 'B', address: '1 Test St', type: 'food', lat: 1, lon: 2 });
      const result = await identifySharedVenue(link);
      expect(result.rows?.map(row => row.verified)).toEqual([false, true]);
      mocks.match.mockRejectedValue(new ProviderUnavailableError('unavailable', 503));
      const failed = await identifySharedVenue(link, { checkedSaved: true, candidates: [item('A'), item('B')] });
      expect(failed.rows).toBeUndefined();
      expect(failed.issue).toMatchObject({ reason: 'unavailable' });
    });

    it('does not check again when the dialog is reopened', async () => {
      mocks.lookup.mockResolvedValue({ data: [], error: null });
      mocks.extract.mockResolvedValue([item('A'), item('B')]);
      mocks.match.mockResolvedValue(null);
      const progress = {};
      await identifySharedVenue(link, progress);
      mocks.match.mockClear();
      mocks.extract.mockClear();
      const again = await identifySharedVenue(link, progress);
      expect(again.rows).toHaveLength(2);
      expect(mocks.match).not.toHaveBeenCalled();
      expect(mocks.extract).not.toHaveBeenCalled();
    });
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

  it('flags an unverified venue in the public link, and only then', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
    vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', 'https://staging.example.test');
    mocks.rpc.mockResolvedValue({ data: 'recommendation-id', error: null });
    await expect(publishVenue(venue, undefined, { unverified: true }))
      .resolves.toBe('https://staging.example.test/venue/recommendation-id?u=1');
    await expect(publishVenue(venue, undefined, { unverified: false }))
      .resolves.toBe('https://staging.example.test/venue/recommendation-id');
  });

  it('shares the message and the link as two separate shares', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    try {
      await expect(sendRecommendationMessage('Down?')).resolves.toBe('shared');
      await expect(sendRecommendationLink('https://example.com/v/test', 'Yee3')).resolves.toBe('shared');
      expect(share.mock.calls).toEqual([
        [{ title: 'Venue recommendation', text: 'Down?' }],
        [{ title: 'Yee3', url: 'https://example.com/v/test' }],
      ]);
    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
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

describe('saves linked to the shared venue', () => {
  const stamped = { ...venue, lat: 1, lon: 2, tags: ['category:cafe'], venueToken: 'stamp' };
  const row = { ...venue, id: 'linked', venue_id: 'shared-1', tags: [] as string[] };

  it('saves a stamped Google place through save-verified-venue', async () => {
    const fetchMock = vi.fn(async () => Response.json(row));
    vi.stubGlobal('fetch', fetchMock);
    mocks.updateTags.mockResolvedValue({ ...row, tags: ['category:cafe'] });
    await expect(saveSharedVenue(stamped, link)).resolves.toMatchObject({ id: 'linked' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/save-verified-venue$/);
    expect(JSON.parse(String(init.body))).toEqual({
      venueToken: 'stamp', name: 'Cafe', address: '1 Test St', type: 'food', link, category: 'cafe',
    });
    vi.unstubAllGlobals();
  });

  it('falls back to the usual save when the linked save is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_venue_token' }, { status: 400 })));
    mocks.rpc.mockResolvedValue({ data: { ...row, id: 'plain', venue_id: null }, error: null });
    mocks.updateTags.mockImplementation(async (id: string, patch: object) => ({ ...row, id, venue_id: null, ...patch }));
    await expect(saveSharedVenue(stamped, link)).resolves.toMatchObject({ id: 'plain' });
    expect(mocks.rpc).toHaveBeenCalledWith('save_shared_venue', {
      p_venue: { name: 'Cafe', address: '1 Test St', type: 'food', lat: 1, lon: 2, link },
    });
    vi.unstubAllGlobals();
  });

  it('falls back when the network fails, and never sends the stamp to the database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    mocks.rpc.mockResolvedValue({ data: { ...row, id: 'plain' }, error: null });
    await saveSharedVenue(stamped, link);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('stamp');
    vi.unstubAllGlobals();
  });

  it('saves an unstamped venue the usual way without calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.rpc.mockResolvedValue({ data: { ...row, id: 'plain' }, error: null });
    await saveSharedVenue(venue, link);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
