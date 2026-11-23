import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractVenuesFromLink } from './openai';

vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));

/** One extraction is one attempt: every request it makes carries one id, so the server counts it once. */
const link = 'https://www.instagram.com/reel/test/';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const aiAnswer = () => Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] });
const metaAnswer = () => Response.json({ platform: 'instagram', url: link, fetched: true, ogDescription: 'Great cafe' });
const sent = (fragment: string) => vi.mocked(fetch).mock.calls
  .filter(([url]) => String(url).includes(fragment)).map(([, init]) => JSON.parse(String(init?.body)));

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

describe('attempt ids in AI Save requests', () => {
  it('sends the dialog id to the metadata service and the AI', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(metaAnswer()).mockResolvedValueOnce(aiAnswer());
    await extractVenuesFromLink(link, { verifySeparately: true, attemptId: '11111111-1111-4111-8111-111111111111' });
    expect(sent('/extract-venue-meta')).toEqual([{ url: link, attempt_id: '11111111-1111-4111-8111-111111111111' }]);
    expect(sent('/ai-proxy')).toHaveLength(1);
    expect(sent('/ai-proxy')[0]).toMatchObject({ purpose: 'extract', attempt_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('creates one id per extraction when none is given, shared by its requests, and a new one for the next', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(metaAnswer()).mockResolvedValueOnce(aiAnswer())
      .mockResolvedValueOnce(metaAnswer()).mockResolvedValueOnce(aiAnswer());
    await extractVenuesFromLink(link);
    await extractVenuesFromLink(link);
    const [firstMeta, secondMeta] = sent('/extract-venue-meta');
    const [firstAi, secondAi] = sent('/ai-proxy');
    expect(firstMeta.attempt_id).toMatch(uuid);
    expect(firstAi.attempt_id).toBe(firstMeta.attempt_id);
    expect(secondAi.attempt_id).toBe(secondMeta.attempt_id);
    expect(secondMeta.attempt_id).not.toBe(firstMeta.attempt_id);
  });

  it('sends the id when a Maps link is resolved', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000', lat: 1, lon: 2 }));
    await extractVenuesFromLink('https://maps.app.goo.gl/AbCdEf123', { verifySeparately: true, attemptId: '22222222-2222-4222-8222-222222222222' });
    expect(sent('/resolve-place')).toEqual([{ url: 'https://maps.app.goo.gl/AbCdEf123', attempt_id: '22222222-2222-4222-8222-222222222222' }]);
  });

  it('keeps the id on a retry that reuses the page metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(aiAnswer());
    const progress = { metadata: { platform: 'instagram', url: link, fetched: true, ogDescription: 'Great cafe' } } as never;
    await extractVenuesFromLink(link, { verifySeparately: true, progress, attemptId: '33333333-3333-4333-8333-333333333333' });
    expect(sent('/extract-venue-meta')).toHaveLength(0);
    expect(sent('/ai-proxy')[0].attempt_id).toBe('33333333-3333-4333-8333-333333333333');
  });
});
