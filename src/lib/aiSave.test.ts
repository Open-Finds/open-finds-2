import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestSave, identifySharedVenue, readGuestSave, sendRecommendation, sourceUrl } from './aiSave';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), match: vi.fn(), rpc: vi.fn(), copy: vi.fn() }));
vi.mock('./openai', () => ({ extractVenuesFromLink: mocks.extract }));
vi.mock('./apiKeys', () => ({ findVenueAddress: mocks.match }));
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./invite', () => ({ APP_URL: 'https://www.theunsaved.app', copyToClipboard: mocks.copy }));

const link = 'https://www.instagram.com/reel/test/';
const venue = { name: 'Cafe', address: '1 Test St', type: 'food' as const, link };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('share venue persistence', () => {
  it('strips reel tracking but preserves a non-social query that identifies a place', () => {
    expect(sourceUrl(link + '?igsh=token')).toBe(link);
    expect(sourceUrl('https://maps.google.com/?cid=12#fragment')).toBe('https://maps.google.com/?cid=12');
    expect(() => sourceUrl('https://user:secret@example.com')).toThrow();
  });

  it('saves a single independently corroborated address and returns the committed row', async () => {
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockResolvedValue({ address: '1 Test St, Australia', lat: 1, lon: 2 });
    const row = { ...venue, id: 'persisted' };
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    await expect(identifySharedVenue(link)).resolves.toMatchObject({ saved: row });
    expect(mocks.rpc).toHaveBeenCalledWith('save_shared_venue', {
      p_venue: expect.objectContaining({ link, lat: 1, lon: 2 }),
    });
  });

  it('does not save ambiguous, missing, or disagreeing addresses', async () => {
    mocks.extract.mockResolvedValueOnce([venue, { ...venue, name: 'Other' }])
      .mockResolvedValueOnce([{ ...venue, address: '' }]).mockResolvedValueOnce([venue]);
    mocks.match.mockResolvedValue({ address: '2 Test St', lat: 1, lon: 2 });
    for (let i = 0; i < 3; i++) await expect(identifySharedVenue(link)).resolves.not.toHaveProperty('saved');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('propagates a write failure instead of returning a successful venue', async () => {
    mocks.extract.mockResolvedValue([venue]);
    mocks.match.mockResolvedValue({ address: venue.address, lat: 1, lon: 2 });
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Write failed') });
    await expect(identifySharedVenue(link)).rejects.toThrow('Write failed');
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
      expect(mocks.copy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
  });
});
