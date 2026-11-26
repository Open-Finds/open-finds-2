import { beforeEach, expect, it, vi } from 'vitest';
import { extractVenuesFromLink, mentionedInSource, NO_CAPTION_MESSAGE } from './openai';
import { readTikTokPost } from './phoneProbe';

const phone = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
vi.mock('./phoneProbe', async original => ({ ...(await original<typeof import('./phoneProbe')>()), readTikTokOnPhone: phone.read }));
vi.stubGlobal('fetch', vi.fn());

const link = 'https://vt.tiktok.com/ZSsrgBNHh/';
const blocked = () => Response.json({ platform: 'tiktok', contentType: 'video', url: link, handle: 'antman', fetched: false });
const ai = (name: string) => Response.json({ choices: [{ message: { content: JSON.stringify({ venues: [{ name, address: 'Carss Park NSW', type: 'food' }] }) } }] });
const page = (items: unknown) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(items)}</script>`;

beforeEach(() => { vi.mocked(fetch).mockReset(); phone.read.mockReset().mockResolvedValue(null); });

it('uses the caption the phone read when the server was turned away', async () => {
  phone.read.mockResolvedValue({ caption: 'UrgerBae is smashing out burgers in Carss Park', location: null });
  vi.mocked(fetch).mockResolvedValueOnce(blocked()).mockResolvedValueOnce(ai('UrgerBae'));
  const progress = {};
  await expect(extractVenuesFromLink(link, { verifySeparately: true, search: false, progress })).resolves.toMatchObject([{ name: 'UrgerBae' }]);
  expect(String(vi.mocked(fetch).mock.calls[1][1]?.body)).toContain('smashing out burgers');
  expect(mentionedInSource(progress, 'UrgerBae')).toBe(true);
});

it('also carries on when the server call itself failed', async () => {
  phone.read.mockResolvedValue({ caption: 'UrgerBae in Carss Park', location: null });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'x' }, { status: 503 })).mockResolvedValueOnce(ai('UrgerBae'));
  await expect(extractVenuesFromLink(link, { verifySeparately: true, search: false })).resolves.toHaveLength(1);
});

it('does not ask the phone when the server read the caption', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'tiktok', contentType: 'video', url: link, fetched: true, oembedTitle: 'UrgerBae burgers' }))
    .mockResolvedValueOnce(ai('UrgerBae'));
  await extractVenuesFromLink(link, { verifySeparately: true, search: false });
  expect(phone.read).not.toHaveBeenCalled();
});

it('still says it could not read the post when neither could', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(blocked());
  await expect(extractVenuesFromLink(link, { verifySeparately: true })).rejects.toThrow(NO_CAPTION_MESSAGE);
  expect(fetch).toHaveBeenCalledOnce();
});

it("takes only the shared post's caption, never another video's on the same page", () => {
  const items = [
    { id: '111', desc: 'Another video, a much longer caption about a different place entirely', video: {} },
    { id: '222', desc: 'UrgerBae, Carss Park', video: {}, poi: { name: 'UrgerBae', address: '12 Carwar Ave' } },
  ];
  expect(readTikTokPost(page({ items }), 'https://www.tiktok.com/@a/video/222')).toMatchObject({
    caption: 'UrgerBae, Carss Park', location: { name: 'UrgerBae', address: '12 Carwar Ave' },
  });
  expect(readTikTokPost(page({ items }), 'https://www.tiktok.com/@a/video/333')).toBeNull();
  expect(readTikTokPost(page({ items }), 'https://vt.tiktok.com/x/')).toBeNull();
  expect(readTikTokPost(page({ item: { desc: 'Only one post', video: {} } }), 'https://vt.tiktok.com/x/')?.caption).toBe('Only one post');
});
