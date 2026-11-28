import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFromScreenshots, sameVenue } from './aiSaveScreenshots';

const mocks = vi.hoisted(() => ({ ai: vi.fn(), search: vi.fn(), near: vi.fn() }));
vi.mock('./apiKeys', () => ({ searchGooglePlaces: mocks.search }));
vi.mock('./openai', () => ({ callAI: mocks.ai }));
vi.mock('./geolocation', () => ({ quietLocation: mocks.near }));

const shot = (n: number) => `data:image/jpeg;base64,${'A'.repeat(n)}`;
const answer = (venues: unknown[]) => mocks.ai.mockResolvedValue(JSON.stringify({ venues }));
const place = (name: string, address: string) => ({ name, address, lat: 1, lon: 2, type: 'food' as const, venueToken: 't' });
const pictures = () => (mocks.ai.mock.calls[0][0][1].content as { type: string }[]).filter(part => part.type === 'image_url');

beforeEach(() => { mocks.ai.mockReset(); mocks.search.mockReset(); mocks.near.mockReset().mockResolvedValue(null); });

describe('findFromScreenshots', () => {
  it('sends the screenshots to the plain AI as AI Save (at most six), then confirms each name on Google near the phone', async () => {
    answer([{ name: 'Boulangerie de Saigon', area: 'Nottingham', type: 'food' }]);
    mocks.near.mockResolvedValue({ lat: 52.95, lon: -1.15 });
    mocks.search.mockResolvedValue([place('Boulangerie de Saigon', 'Low Pavement, Nottingham NG1 7DQ, UK')]);
    const rows = await findFromScreenshots(Array.from({ length: 8 }, (_, i) => shot(i + 4)), 'attempt');
    expect(mocks.ai.mock.calls[0][1]).toMatchObject({ purpose: 'extract', model: 'openai/gpt-4o-mini', attemptId: 'attempt' });
    expect(pictures()).toHaveLength(6);
    expect(mocks.search).toHaveBeenCalledWith('Boulangerie de Saigon Nottingham', 'attempt', { lat: 52.95, lon: -1.15 });
    expect(rows).toEqual([expect.objectContaining({ verified: true, venue: expect.objectContaining({ address: 'Low Pavement, Nottingham NG1 7DQ, UK' }) })]);
  });

  it('only suggests (never ticks) when several places share a name and no area says which', async () => {
    answer([{ name: 'Banh Mi Bay', area: '' }]);
    mocks.search.mockResolvedValue([place('Banh Mi Bay', 'Sydney NSW'), place('Banh Mi Bay', 'Melbourne VIC')]);
    const [row] = await findFromScreenshots([shot(4)], 'attempt');
    expect(row.verified).toBe(false);
    expect(row.suggestion?.address).toBe('Sydney NSW');
  });

  it('never confirms a place in another area, or with another name, and keeps what the AI read', async () => {
    answer([{ name: 'Pho Table', area: 'Newtown' }, { name: 'Hong Ha', area: '' }]);
    mocks.search.mockImplementation(async (query: string) => query.startsWith('Pho')
      ? [place('Pho Table', 'Cabramatta NSW')] : [place('Muoi Tieu', 'Takoma Park, MD, USA')]);
    const rows = await findFromScreenshots([shot(4)], 'attempt');
    expect(rows.map(row => [row.venue.name, row.verified, row.suggestion])).toEqual([['Pho Table', false, undefined], ['Hong Ha', false, undefined]]);
  });

  it('reports progress for the loading ring: read, then each Google check (a failed one too)', async () => {
    answer([{ name: 'Pho Table', area: '' }, { name: 'Hong Ha', area: '' }]);
    mocks.search.mockResolvedValueOnce([place('Pho Table', 'Newtown NSW')]).mockRejectedValueOnce(new Error('down'));
    const onProgress = vi.fn();
    await findFromScreenshots([shot(4)], 'attempt', onProgress);
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0.6, expect.closeTo(0.775), expect.closeTo(0.95)]);
  });

  it('gives an empty list when the AI reads no venue, and asks nothing for no pictures', async () => {
    answer([]);
    expect(await findFromScreenshots([shot(4)], 'attempt')).toEqual([]);
    mocks.ai.mockReset();
    expect(await findFromScreenshots([], 'attempt')).toEqual([]);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});

describe('sameVenue', () => {
  it('matches a name either way round, and the first part of a written area', () => {
    const venue = { name: 'boulangeriedesaigon', area: 'Nottingham, UK', type: 'food' as const };
    expect(sameVenue(venue, place('Boulangerie de Saigon', 'Low Pavement, Nottingham, UK'))).toBe(true);
    expect(sameVenue(venue, place('Boulangerie de Saigon', 'Leeds, UK'))).toBe(false);
    expect(sameVenue({ ...venue, area: '' }, place('La Boulangerie', 'San Francisco'))).toBe(false);
  });
});
