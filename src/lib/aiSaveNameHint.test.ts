import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findByName, nameHint } from './aiSaveNameHint';
import type { ExtractedVenueItem, VenueExtractionProgress } from './openai';

const mocks = vi.hoisted(() => ({ search: vi.fn(), near: vi.fn() }));
vi.mock('./apiKeys', () => ({ searchGooglePlaces: mocks.search }));
vi.mock('./geolocation', () => ({ quietLocation: mocks.near }));

const post = (handle: string | null) => ({ metadata: { platform: 'instagram', handle } }) as unknown as VenueExtractionProgress;
const item = (name: string): ExtractedVenueItem => ({ name, address: '', type: 'food', order: 1, tags: ['vietnamese'] });
const place = (name: string, address: string) => ({ name, address, lat: 52.95, lon: -1.15, type: 'food' as const, venueToken: 't' });
const link = 'https://www.instagram.com/p/x/';

beforeEach(() => { mocks.search.mockReset(); mocks.near.mockReset().mockResolvedValue(null); });

describe('nameHint', () => {
  it('uses the one name the AI read, else the handle as words, never a list or a scrap', () => {
    expect(nameHint([item('Boulangerie de Saigon')], 'someone')).toEqual({ name: 'Boulangerie de Saigon', fromHandle: false });
    expect(nameHint([], 'boulangerie_de.saigon')).toEqual({ name: 'boulangerie de saigon', fromHandle: true });
    expect(nameHint([item('A'), item('B')], 'x_handle')).toBeNull();
    expect(nameHint([], 'abc')).toBeNull();
  });
});

describe('findByName', () => {
  // Regression: the AI with web search once picked "Muoi Tieu" in Maryland, USA for this Nottingham bakery.
  it('confirms the single Google place with the post\'s name, ranked near the phone', async () => {
    mocks.near.mockResolvedValue({ lat: 52.95, lon: -1.15 });
    mocks.search.mockResolvedValue([place('Boulangerie de Saigon', 'Low Pavement, Nottingham, UK'), place('La Boulangerie', 'San Francisco, USA')]);
    const result = await findByName([item('Boulangerie de Saigon')], post('boulangeriedesaigon'), link, 'attempt');
    expect(mocks.search).toHaveBeenCalledWith('Boulangerie de Saigon', 'attempt', { lat: 52.95, lon: -1.15 });
    expect(result).toEqual({ venue: expect.objectContaining({
      name: 'Boulangerie de Saigon', address: 'Low Pavement, Nottingham, UK', link, venueToken: 't', tags: ['vietnamese'],
    }) });
  });

  it('offers every branch to pick from when several places share the name', async () => {
    mocks.search.mockResolvedValue([place('Bánh Mì Bay', 'Sydney'), place('Banh Mi Bay', 'Melbourne')]);
    const result = await findByName([item('Banh Mi Bay')], post(null), link, undefined);
    expect(result && 'choices' in result && result.choices.map(choice => choice.address)).toEqual(['Sydney', 'Melbourne']);
  });

  it('only offers (never confirms) a place found from the account handle', async () => {
    mocks.search.mockResolvedValue([place('Kei Eats', 'Sydney')]);
    const result = await findByName([], post('kei_eats'), link, undefined);
    expect(result && 'choices' in result).toBe(true);
  });

  it('gives up (so AI Save carries on as before) when no Google place has the name', async () => {
    mocks.search.mockResolvedValue([place('Muoi Tieu', 'Takoma Park, MD, USA')]);
    expect(await findByName([item('Boulangerie de Saigon')], post(null), link, undefined)).toBeNull();
    expect(await findByName([], post(null), link, undefined)).toBeNull();
  });
});
