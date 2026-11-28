import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findBranches, listedSuburbs } from './aiSaveBranches';
import type { VenueExtractionProgress } from './openai';
import type { VenueRow } from './aiSave';

const search = vi.hoisted(() => vi.fn());
vi.mock('./apiKeys', () => ({ searchGooglePlaces: search }));
vi.mock('./openai', () => ({ captionPlainText: (meta: { ogDescription: string }) => meta.ogDescription }));

const caption = [
  'On the menu from 1 December.', '👉 Book now: https://thirdwavebbq.com.au/book/', '',
  '𝗟𝗼𝗰𝗮𝘁𝗶𝗼𝗻𝘀:', '📍 Hawthorn | Moorabbin | Albert Park | Officer | Ascot Vale', '📍 Applecross | Surfers Paradise', '',
  '🍪 FREE COOKIE ALERT',
].join('\n');
const post = (ogDescription = caption) =>
  ({ metadata: { platform: 'instagram', handle: 'thirdwavebbq', ogTitle: null, ogDescription } }) as unknown as VenueExtractionProgress;
const row = (name: string, address = ''): VenueRow => ({ venue: { name, address, type: 'food', link: 'x', tags: [] }, verified: false });
const place = (suburb: string, name = `Third Wave BBQ ${suburb}`) => ({ name, address: `1 High St, ${suburb} VIC 3000`, lat: -37, lon: 145 });
const run = (rows = [row('Hawthorn'), row('Moorabbin')], identification = post()) => findBranches(rows, identification, 'x', 'attempt', 5);

describe('listedSuburbs', () => {
  it('reads the list under Locations, in bold letters and over several lines', () => {
    expect(listedSuburbs(caption)).toEqual(['Hawthorn', 'Moorabbin', 'Albert Park', 'Officer', 'Ascot Vale', 'Applecross', 'Surfers Paradise']);
  });
  it('stops at the end of the list when the caption is one line', () => {
    expect(listedSuburbs('Locations: 📍 Hawthorn | Officer 🍪 FREE COOKIE ALERT')).toEqual(['Hawthorn', 'Officer']);
  });
  it('finds nothing without a Locations heading', () => {
    expect(listedSuburbs('📍 Hawthorn | Officer')).toEqual([]);
  });
});

describe('findBranches', () => {
  beforeEach(() => { search.mockReset(); });

  it('finds up to five branches by business name and suburb', async () => {
    search.mockImplementation(async (query: string) => [place(query.replace('thirdwavebbq ', ''))]);
    const result = await run();
    expect(search).toHaveBeenCalledTimes(5);
    expect(result.map(item => item.venue.name)).toEqual(['Hawthorn', 'Moorabbin', 'Albert Park', 'Officer', 'Ascot Vale'].map(s => `Third Wave BBQ ${s}`));
    expect(result.every(item => item.verified && item.venue.address)).toBe(true);
  });

  it('never runs when any venue already has an address', async () => {
    const rows = [row('Hawthorn', '1 High St'), row('Moorabbin')];
    expect(await run(rows)).toBe(rows);
    expect(search).not.toHaveBeenCalled();
  });

  it('never runs for a post without a Locations list', async () => {
    const rows = [row('A'), row('B')];
    expect(await run(rows, post('Great ribs at https://thirdwavebbq.com.au/'))).toBe(rows);
    expect(search).not.toHaveBeenCalled();
  });

  it('refuses another business, another suburb, or two places for one suburb', async () => {
    search.mockImplementation(async (query: string) => {
      if (query.endsWith('Hawthorn')) return [place('Hawthorn')];
      if (query.endsWith('Moorabbin')) return [place('Moorabbin', 'Some Other BBQ')];
      if (query.endsWith('Albert Park')) return [place('Richmond')];
      if (query.endsWith('Officer')) return [place('Officer'), place('Officer')];
      return [];
    });
    const result = await run();
    expect(result.map(item => item.verified)).toEqual([true, false, false, false, false]);
    expect(result.slice(1).every(item => item.venue.address === '')).toBe(true);
  });

  it('keeps the original result when Google finds nothing or fails', async () => {
    const rows = [row('Hawthorn'), row('Moorabbin')];
    search.mockRejectedValue(new Error('down'));
    expect(await run(rows)).toBe(rows);
    search.mockResolvedValue([]);
    expect(await run(rows)).toBe(rows);
  });
});
