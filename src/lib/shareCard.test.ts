import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../api/_recommendation.js', () => ({
  loadRecommendation: loaded.load,
  isUnverified: (req: { query?: { u?: string } }) => req.query?.u === '1',
}));
import venuePage from '../../api/venue.js';
import venueImage, { renderCard } from '../../api/venue-image.js';

const id = '3b7b7392-9645-4c68-a478-ad812be03ba4';
const origin = 'https://www.theunsaved.app';
const found = (venue: Record<string, unknown>) => ({ venue, origin, staging: false });

function reply() {
  const res = { code: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    status(code: number) { res.code = code; return res; },
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; },
    send(body: unknown) { res.body = body; return res; } };
  return res;
}

beforeEach(() => loaded.load.mockReset());

describe('share card image', () => {
  it('renders a 1200 by 630 PNG', async () => {
    const png = Buffer.from(await renderCard({ name: 'Yee3', address: 'Shop 6/385 Pitt St, Sydney NSW 2000', type: 'dessert' }));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('still renders for an unknown type, a very long name and an empty address', async () => {
    const png = await renderCard({ name: 'x'.repeat(400), address: '', type: 'mystery' });
    expect(png.length).toBeGreaterThan(1000);
  });

  it('serves the PNG, cached, with the venue name cleaned', async () => {
    loaded.load.mockResolvedValue(found({ name: 'Yee3 • World Square •', address: '385 Pitt St', type: 'dessert' }));
    const res = reply();
    await venueImage({ query: { id } }, res);
    expect(res.code).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('s-maxage');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it('passes a missing venue through as the same error the page gives', async () => {
    loaded.load.mockResolvedValue({ error: { status: 404, message: 'Recommendation not found' } });
    const res = reply();
    await venueImage({ query: { id } }, res);
    expect(res.code).toBe(404);
    expect(res.body).toBe('Recommendation not found');
  });
});

describe('public venue page', () => {
  const venue = { name: 'Yee3 • World Square •', address: 'Shop 6/385 Pitt St, Sydney NSW 2000', type: 'dessert', link: 'https://www.instagram.com/reel/x/' };

  it('previews with the clean name, the address and the generated card, and no site suffix in the title', async () => {
    loaded.load.mockResolvedValue(found(venue));
    const res = reply();
    await venuePage({ query: { id } }, res);
    const html = String(res.body);
    expect(res.code).toBe(200);
    // The card title is the name and the address, like "Urth Cafe | 4/165 Wattle St, Mount Lewis NSW 2190".
    expect(html).toContain('<meta property="og:title" content="Yee3 • World Square | Shop 6/385 Pitt St, Sydney NSW 2000">');
    expect(html).toContain('<title>Yee3 • World Square | Shop 6/385 Pitt St, Sydney NSW 2000</title>');
    expect(html).toContain('<meta property="og:description" content="Shop 6/385 Pitt St, Sydney NSW 2000">');
    expect(html).toContain(`<meta property="og:image" content="${origin}/api/venue-image?id=${id}">`);
    expect(html).toContain('content="1200"');
    expect(html).not.toContain('| The Unsaved');
    expect(html).not.toContain('Address not confirmed');
  });

  it('uses just the name as the title when there is no address', async () => {
    loaded.load.mockResolvedValue(found({ ...venue, address: '  ' }));
    const res = reply();
    await venuePage({ query: { id } }, res);
    expect(String(res.body)).toContain('<meta property="og:title" content="Yee3 • World Square">');
  });

  it('says so, on the page and in the card link, when the address is not confirmed', async () => {
    loaded.load.mockResolvedValue(found(venue));
    const res = reply();
    await venuePage({ query: { id, u: '1' } }, res);
    const html = String(res.body);
    expect(html).toContain('Address not confirmed on Google Maps. Check it before you go.');
    expect(html).toContain(`/api/venue-image?id=${id}&amp;u=1`);
  });

  it('escapes venue text and keeps only https links', async () => {
    loaded.load.mockResolvedValue(found({ ...venue, name: '<script>x</script>', link: 'javascript:alert(1)' }));
    const res = reply();
    await venuePage({ query: { id } }, res);
    const html = String(res.body);
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Watch original Reel');
  });

  it('returns the loader error unchanged', async () => {
    loaded.load.mockResolvedValue({ error: { status: 503, message: 'Venue recommendations are unavailable' } });
    const res = reply();
    await venuePage({ query: { id } }, res);
    expect([res.code, res.body]).toEqual([503, 'Venue recommendations are unavailable']);
  });
});
