import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeProbe, phoneCheckEnabled, platformOf, probePost, readPostPage, type Fetched, type Fetcher } from './phoneProbe';

afterEach(() => vi.unstubAllEnvs());

const tiktokPage = (data: unknown, extraHead = '') =>
  `<html><head>${extraHead}</head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

const photoCaption = '3. The Palace restaurant in the city. 2. Feng You in Hurstville.';
const photoPost = tiktokPage({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
  desc: photoCaption,
  imagePost: { images: [
    { imageURL: { urlList: ['https://p16-sign.tiktokcdn.com/obj/a.jpeg?x=1&y=2'] } },
    { imageURL: { urlList: ['https://p16.tiktokcdn.com/b.jpeg'] } },
  ] },
  music: { title: 'x' },
} } } } });

const videoPost = tiktokPage({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
  desc: 'Best yum cha',
  video: { playAddr: 'https://v16.tiktokcdn.com/v.mp4?sig=1' },
  poi: { name: 'Ocean Royale', address: 'Auburn NSW' },
} } } } });

describe('reading a TikTok page', () => {
  it('finds the caption and the photo slides of a photo post', () => {
    const page = readPostPage(photoPost, 'tiktok');
    expect(page).toMatchObject({ captionChars: photoCaption.length, photoSlides: 2, locationTag: false, videoLink: false, loginWall: false });
    expect(page.mediaUrl).toBe('https://p16-sign.tiktokcdn.com/obj/a.jpeg?x=1&y=2');
    expect(page.keysSeen).toEqual(expect.arrayContaining(['desc', 'imagePost', 'images', 'music']));
  });

  it('finds the location tag and the video link of a video', () => {
    const page = readPostPage(videoPost, 'tiktok');
    expect(page).toMatchObject({ locationTag: true, videoLink: true, photoSlides: 0, captionChars: 12 });
    expect(page.mediaUrl).toBe('https://v16.tiktokcdn.com/v.mp4?sig=1');
  });

  it('copes with the older layout, a caption only in the page description, and a page with no data', () => {
    expect(readPostPage('<meta property="og:description" content="Only the og caption">', 'tiktok').captionChars).toBe('Only the og caption'.length);
    expect(readPostPage('<html></html>', 'tiktok')).toMatchObject({ captionChars: 0, photoSlides: 0, videoLink: false, locationTag: false, keysSeen: [] });
    expect(readPostPage('<script id="SIGI_STATE" type="application/json">{not json</script>', 'tiktok').keysSeen).toEqual([]);
  });

  it('never offers an unsafe media address (plain http, an IP address, or one with a password)', () => {
    for (const bad of ['http://v16.tiktokcdn.com/v.mp4', 'https://10.0.0.1/v.mp4', 'https://user:pw@v16.tiktokcdn.com/v.mp4', 'https://localhost/v.mp4']) {
      const html = tiktokPage({ item: { desc: 'x', video: { playAddr: bad } } });
      expect(readPostPage(html, 'tiktok').mediaUrl).toBeUndefined();
    }
  });

  it('spots a log-in wall', () => {
    expect(readPostPage('<html></html>', 'tiktok', 'https://www.tiktok.com/login?redirect_url=x').loginWall).toBe(true);
    expect(readPostPage('<form id="loginForm"></form>', 'instagram', 'https://www.instagram.com/reel/x/').loginWall).toBe(true);
    expect(readPostPage(photoPost, 'tiktok', 'https://www.tiktok.com/@a/photo/1').loginWall).toBe(false);
  });
});

describe('reading an Instagram page', () => {
  const html = String.raw`<meta property="og:description" content="1,234 likes - a caption about pizza">` +
    String.raw`<script>{"video_url":"https:\/\/scontent.cdninstagram.com\/v\/t50\/clip.mp4?a=1&b=2","location":{"name":"X"},"carousel_media_count":3}</script>`;
  it('finds the caption, the location, the slides and the video link', () => {
    const page = readPostPage(html, 'instagram');
    expect(page).toMatchObject({ locationTag: true, photoSlides: 3, videoLink: true });
    expect(page.captionChars).toBeGreaterThan(10);
    expect(page.mediaUrl).toBe('https://scontent.cdninstagram.com/v/t50/clip.mp4?a=1&b=2');
  });
});

describe('platformOf and when the phone check is shown', () => {
  it('knows TikTok and Instagram links, including short links', () => {
    expect(platformOf('https://vt.tiktok.com/ZSsFTaXA9/')).toBe('tiktok');
    expect(platformOf('https://www.instagram.com/reel/x/')).toBe('instagram');
    expect(platformOf('https://nottiktok.com/x')).toBe('other');
    expect(platformOf('https://example.com/?u=tiktok.com')).toBe('other');
    expect(platformOf('not a link')).toBe('other');
  });

  it('is shown only in the staging test build, and only for those two sites', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
    expect(phoneCheckEnabled('https://vt.tiktok.com/ZSsFTaXA9/')).toBe(true);
    expect(phoneCheckEnabled('https://example.com/cafes')).toBe(false);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://wfrlkifdlgmlbffumglt.supabase.co');
    expect(phoneCheckEnabled('https://vt.tiktok.com/ZSsFTaXA9/')).toBe(false);
  });
});

describe('probePost', () => {
  const link = 'https://vt.tiktok.com/ZSsFTaXA9/';
  const reply = (status: number, text = '', url = 'https://www.tiktok.com/@a/photo/1', headers: Record<string, string> = {}): Fetched => ({ status, url, headers, text });

  it('reads the page, then opens only two bytes of the first media file, and reports both', async () => {
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(reply(200, photoPost))
      .mockResolvedValueOnce(reply(206, '', 'x', { 'Content-Type': 'image/jpeg' }));
    const probe = await probePost(link, fetcher);
    expect(probe).toMatchObject({ platform: 'tiktok', reached: true, status: 200, finalHost: 'www.tiktok.com', media: 'reachable (206, image/jpeg)' });
    expect(probe.page?.photoSlides).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('https://p16-sign.tiktokcdn.com/obj/a.jpeg?x=1&y=2');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ Range: 'bytes=0-1' });
  });

  it('says so when the media file is refused', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(reply(200, videoPost)).mockResolvedValueOnce(reply(403));
    expect((await probePost(link, fetcher)).media).toBe('refused (403)');
  });

  it('does not try a media file when the page points to none', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(reply(200, '<html></html>'));
    const probe = await probePost(link, fetcher);
    expect(probe.media).toBe('no media address on the page');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports a refused page, a failed request and a media failure without throwing', async () => {
    expect(await probePost(link, async () => reply(429))).toMatchObject({ reached: false, status: 429, error: 'The page answered 429.' });
    expect(await probePost(link, async () => { throw new Error('timeout'); })).toMatchObject({ reached: false, error: 'Could not open the page (timeout).' });
    const failing = vi.fn<Fetcher>().mockResolvedValueOnce(reply(200, videoPost)).mockRejectedValueOnce(new Error('offline'));
    expect((await probePost(link, failing)).media).toBe('could not be opened (offline)');
  });

  it('does nothing for a link that is not TikTok or Instagram', async () => {
    const fetcher = vi.fn();
    expect(await probePost('https://example.com/x', fetcher)).toMatchObject({ platform: 'other', reached: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('describes the result as plain lines to read or copy', async () => {
    const fetcher: Fetcher = vi.fn().mockResolvedValueOnce(reply(200, photoPost)).mockResolvedValueOnce(reply(206, '', 'x', { 'content-type': 'image/jpeg' }));
    const lines = describeProbe(link, await probePost(link, fetcher));
    expect(lines).toEqual(expect.arrayContaining([
      `Caption: ${photoCaption.length} characters`, 'Location tag: no', 'Photo slides: 2', 'Video link: no', 'Media file: reachable (206, image/jpeg)', 'Log-in wall: no',
    ]));
    expect(lines[0]).toContain('tiktok post');
    const refused = describeProbe(link, { platform: 'tiktok', via: 'phone', reached: false, error: 'The page answered 429.' });
    expect(refused[refused.length - 1]).toBe('Page: not reached. The page answered 429.');
  });
});
