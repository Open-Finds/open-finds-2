import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findFromSlides, slideVenues } from './aiSaveSlides';
import type { VenueExtractionProgress } from './openai';

const mocks = vi.hoisted(() => ({ ai: vi.fn(), search: vi.fn() }));
vi.mock('./apiKeys', () => ({ searchGooglePlaces: mocks.search }));
vi.mock('./openai', () => ({ callAI: mocks.ai, captionPlainText: () => 'Sydney best banh mi' }));

const slides = ['https://x.cdninstagram.com/1.jpg', 'https://x.cdninstagram.com/2.jpg'];
const post = (extra: Record<string, unknown> = {}) =>
  ({ metadata: { platform: 'instagram', handle: 'timeoutsydney', slides, ...extra } }) as unknown as VenueExtractionProgress;
const answer = (venues: unknown[]) => mocks.ai.mockResolvedValue(JSON.stringify({ venues }));
const place = (name: string, suburb: string) => ({ name, address: `1 Main St, ${suburb} NSW 2000`, lat: -33.9, lon: 151 });
const run = (identification = post()) => findFromSlides(identification, 'https://www.instagram.com/p/x/', 'attempt', 5);
const pictures = (call: number) => (mocks.ai.mock.calls[call][0][1].content as { type: string }[]).filter(part => part.type === 'image_url');

beforeEach(() => { mocks.ai.mockReset(); mocks.search.mockReset(); });

describe('slideVenues', () => {
  it('keeps named venues once each, up to the limit, with a safe type', () => {
    expect(slideVenues(JSON.stringify({ venues: [
      { name: 'Phuong 18', area: 'Bankstown', type: 'food' }, { name: 'phuong 18' }, { name: '' }, { name: 'Bae Mi', type: 'nonsense' },
    ] }), 5)).toEqual([{ name: 'Phuong 18', area: 'Bankstown', type: 'food' }, { name: 'Bae Mi', area: '', type: 'food' }]);
    expect(slideVenues('not json', 5)).toEqual([]);
  });
});

describe('findFromSlides', () => {
  it('sends the slide pictures to the AI as AI Save, then confirms each name on Google', async () => {
    answer([{ name: 'Phuong 18', area: 'Bankstown' }, { name: 'Bae Mi', area: 'Riverwood' }]);
    mocks.search.mockImplementation(async (query: string) => query.startsWith('Phuong')
      ? [place('Phuong 18', 'Bankstown')] : [place('Bae Mi', 'Riverwood')]);
    const rows = await run();
    expect(mocks.ai.mock.calls[0][1]).toMatchObject({ purpose: 'extract', model: 'openai/gpt-4o-mini', attemptId: 'attempt' });
    expect(pictures(0)).toHaveLength(2);
    expect(mocks.search.mock.calls.map(([query]) => query)).toEqual(['Phuong 18 Bankstown', 'Bae Mi Riverwood']);
    expect(rows?.map(row => [row.venue.name, row.verified])).toEqual([['Phuong 18', true], ['Bae Mi', true]]);
  });

  it('confirms nothing in the wrong suburb, offers a near miss only as a suggestion, and never guesses', async () => {
    answer([{ name: 'Phuong 18', area: 'Bankstown' }, { name: 'Bae Mi', area: 'Riverwood' }, { name: 'Hong Ha', area: 'Mascot' }]);
    mocks.search.mockImplementation(async (query: string) => {
      if (query.startsWith('Phuong')) return [place('Phuong 18', 'Cabramatta')];
      if (query.startsWith('Bae')) return [place('Bae Mi', 'Riverwood'), place('Bae Mi Express', 'Riverwood')];
      return [place('Hong Ha Bakery', 'Mascot')];
    });
    const rows = await run();
    expect(rows?.map(row => row.verified)).toEqual([false, false, true]);
    expect(rows?.[0].suggestion).toBeUndefined();
    expect(rows?.[1].suggestion?.name).toBe('Bae Mi');
    expect(rows?.[1].venue.address).toBe('');
  });

  it('keeps the usual result when the AI reads nothing or Google confirms nothing', async () => {
    answer([]);
    expect(await run()).toBeNull();
    answer([{ name: 'Phuong 18', area: 'Bankstown' }]);
    mocks.search.mockResolvedValue([]);
    expect(await run()).toBeNull();
  });

  it('never asks the AI without at least two slides, or for anything but Instagram', async () => {
    expect(await run(post({ slides: [slides[0]] }))).toBeNull();
    expect(await run(post({ platform: 'tiktok' }))).toBeNull();
    expect(mocks.ai).not.toHaveBeenCalled();
  });

  it('sends at most six slides', async () => {
    answer([]);
    await run(post({ slides: Array.from({ length: 9 }, (_, i) => `https://x.cdninstagram.com/${i}.jpg`) }));
    expect(pictures(0)).toHaveLength(6);
  });
});
