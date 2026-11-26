import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { stagingSupabase } from './publicRecommendation.js';

/**
 * Test-build tool: what can the PHONE itself read from a TikTok or Instagram post?
 *
 * TikTok turns away about one request in three from our servers, and a venue named only in the video, the voice-over or
 * the photo slides cannot be read from the caption at all. Before building the way to read them, this finds out (for free,
 * with no AI call) what a phone can reach: the caption, the location tag, the photo slides, a video link, and whether the
 * media file itself can be opened. Nothing leaves the phone except the requests to TikTok or Instagram.
 */

export type Fetched = { status: number; url: string; headers: Record<string, string>; text: string };
export type Fetcher = (url: string, headers: Record<string, string>) => Promise<Fetched>;

export type PostPage = {
  loginWall: boolean;
  captionChars: number;
  locationTag: boolean;
  photoSlides: number;
  videoLink: boolean;
  /** The first media file the page points to (a photo slide, else the video). Not shown; only tested. */
  mediaUrl?: string;
  /** Names of the data fields found, to learn the page's layout. */
  keysSeen: string[];
};

export type PhoneProbe = {
  platform: 'tiktok' | 'instagram' | 'other';
  via: 'phone' | 'browser';
  /** The page could be fetched. */
  reached: boolean;
  status?: number;
  finalHost?: string;
  htmlKB?: number;
  page?: PostPage;
  /** What happened when the first media file was asked for (2 bytes only). */
  media?: string;
  error?: string;
};

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const TIMEOUT = 15_000;

export function platformOf(link: string): PhoneProbe['platform'] {
  try {
    const host = new URL(link).hostname.toLowerCase();
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  } catch { /* not a link */ }
  return 'other';
}

/** Only the test build, which runs against the staging project, shows the phone check. */
export function phoneCheckEnabled(link: string): boolean {
  return import.meta.env.VITE_SUPABASE_URL === stagingSupabase && platformOf(link) !== 'other';
}

/** A media address from a page is only opened when it is plain https to a named host. */
function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').replace(/\\\//g, '/'));
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) return;
    return url.href;
  } catch { return; }
}

const KEYS_OF_INTEREST = ['desc', 'poi', 'imagePost', 'images', 'playAddr', 'downloadAddr', 'bitrateInfo', 'music', 'textExtra', 'video'];

/** Walks the page's data without assuming its layout, so a change to TikTok's pages still shows what is in them. */
function walk(root: unknown) {
  const found = { desc: '', poi: false, images: 0, imageUrl: undefined as string | undefined, videoUrl: undefined as string | undefined, keys: new Set<string>() };
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 14 || nodes++ > 200_000) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (KEYS_OF_INTEREST.includes(key)) found.keys.add(key);
      if (key === 'desc' && typeof child === 'string' && child.length > found.desc.length) found.desc = child;
      else if (key === 'poi' && child && typeof child === 'object' && Object.keys(child).length) found.poi = true;
      else if (key === 'imagePost' && child && typeof child === 'object') {
        const images = (child as { images?: unknown }).images;
        if (Array.isArray(images)) {
          found.images = Math.max(found.images, images.length);
          const first = images[0] as { imageURL?: { urlList?: unknown[] } } | undefined;
          found.imageUrl ??= safeMediaUrl(first?.imageURL?.urlList?.[0]);
        }
      } else if ((key === 'playAddr' || key === 'downloadAddr') && typeof child === 'string') found.videoUrl ??= safeMediaUrl(child);
      else if (key === 'UrlList' && Array.isArray(child)) found.videoUrl ??= safeMediaUrl(child[0]);
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

function jsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]*id="(?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)"[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    try { blocks.push(JSON.parse(match[1])); } catch { /* a block that is not JSON is skipped */ }
  }
  return blocks;
}

function meta(html: string, property: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]*>`, 'i'))?.[0];
  return tag?.match(/content="([^"]*)"/i)?.[1];
}

/** What a post's page holds: its caption, location tag, photo slides and video link. Pure, so it can be tested without a phone. */
export function readPostPage(html: string, platform: PhoneProbe['platform'], finalUrl = ''): PostPage {
  const loginUrl = /\/(?:accounts\/login|login)(?:[/?]|$)/i.test(finalUrl);
  const loginPage = /id="loginForm"|name="loginForm"|Log in to (?:TikTok|Instagram)/i.test(html) && html.length < 80_000;
  const loginWall = loginUrl || loginPage;
  if (platform === 'tiktok') {
    const found = jsonBlocks(html).map(walk);
    const best = found.sort((a, b) => b.desc.length - a.desc.length)[0];
    const og = meta(html, 'og:description') ?? '';
    return {
      loginWall,
      captionChars: Math.max(best?.desc.length ?? 0, og.length),
      locationTag: found.some(item => item.poi),
      photoSlides: Math.max(0, ...found.map(item => item.images)),
      videoLink: found.some(item => !!item.videoUrl) || !!meta(html, 'og:video'),
      mediaUrl: found.map(item => item.imageUrl).find(Boolean) ?? found.map(item => item.videoUrl).find(Boolean) ?? safeMediaUrl(meta(html, 'og:video')),
      keysSeen: [...new Set(found.flatMap(item => [...item.keys]))].sort(),
    };
  }
  const caption = meta(html, 'og:description') ?? meta(html, 'description') ?? '';
  const videoUrl = safeMediaUrl(html.match(/"video_url"\s*:\s*"([^"]+)"/)?.[1]) ?? safeMediaUrl(html.match(/"video_versions"\s*:\s*\[\s*\{[^}]*?"url"\s*:\s*"([^"]+)"/)?.[1]) ?? safeMediaUrl(meta(html, 'og:video'));
  const slides = Number(html.match(/"carousel_media_count"\s*:\s*(\d+)/)?.[1] ?? 0);
  const keys = ['video_url', 'video_versions', 'carousel_media', 'edge_sidecar_to_children', 'location', 'caption'].filter(key => html.includes(`"${key}"`));
  return {
    loginWall, captionChars: caption.length, locationTag: /"location"\s*:\s*\{/.test(html), photoSlides: slides,
    videoLink: !!videoUrl, mediaUrl: videoUrl ?? safeMediaUrl(meta(html, 'og:image')), keysSeen: keys,
  };
}

/** The phone's own network call (no browser rules about other sites), else the browser's, which usually cannot read these pages. */
export const defaultFetcher: Fetcher = async (url, headers) => {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: TIMEOUT, readTimeout: TIMEOUT });
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    return { status: response.status, url: response.url || url, headers: response.headers ?? {}, text };
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  return { status: response.status, url: response.url || url, headers: Object.fromEntries(response.headers.entries()), text: await response.text() };
};

function mediaSummary(status: number, headers: Record<string, string>): string {
  const type = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.split(';')[0] ?? 'unknown type';
  return status === 200 || status === 206 ? `reachable (${status}, ${type})` : `refused (${status})`;
}

/** Fetches the post from the phone and reports what it found. Never throws. */
export async function probePost(link: string, fetcher: Fetcher = defaultFetcher): Promise<PhoneProbe> {
  const platform = platformOf(link);
  const via: PhoneProbe['via'] = Capacitor.isNativePlatform() ? 'phone' : 'browser';
  if (platform === 'other') return { platform, via, reached: false, error: 'Not a TikTok or Instagram link.' };
  let page: Fetched;
  try {
    page = await fetcher(link, { 'User-Agent': MOBILE_UA, 'Accept-Language': 'en-AU,en;q=0.9', Accept: 'text/html,application/xhtml+xml' });
  } catch (error) {
    return { platform, via, reached: false, error: `Could not open the page (${error instanceof Error ? error.message : 'network error'}).` };
  }
  const result: PhoneProbe = {
    platform, via, reached: page.status >= 200 && page.status < 400, status: page.status,
    finalHost: (() => { try { return new URL(page.url).hostname; } catch { return undefined; } })(),
    htmlKB: Math.round(page.text.length / 1024),
  };
  if (!result.reached) return { ...result, error: `The page answered ${page.status}.` };
  result.page = readPostPage(page.text, platform, page.url);
  const mediaUrl = result.page.mediaUrl;
  if (!mediaUrl) return { ...result, media: 'no media address on the page' };
  try {
    const media = await fetcher(mediaUrl, { 'User-Agent': MOBILE_UA, Range: 'bytes=0-1', Referer: new URL(page.url).origin + '/' });
    return { ...result, media: mediaSummary(media.status, media.headers) };
  } catch (error) {
    return { ...result, media: `could not be opened (${error instanceof Error ? error.message : 'network error'})` };
  }
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/** The result as plain lines, for the panel and for copying into a message. */
export function describeProbe(link: string, probe: PhoneProbe): string[] {
  const lines = [`Phone check: ${probe.platform} post, read by the ${probe.via}`, `Link: ${link}`];
  if (!probe.reached) return [...lines, `Page: not reached. ${probe.error ?? ''}`.trim()];
  lines.push(`Page: reached (${probe.status}${probe.htmlKB !== undefined ? `, ${probe.htmlKB} KB` : ''}${probe.finalHost ? `, ${probe.finalHost}` : ''})`);
  const page = probe.page;
  if (!page) return lines;
  lines.push(
    `Log-in wall: ${yesNo(page.loginWall)}`,
    `Caption: ${page.captionChars ? `${page.captionChars} characters` : 'none found'}`,
    `Location tag: ${yesNo(page.locationTag)}`,
    `Photo slides: ${page.photoSlides || 'none'}`,
    `Video link: ${yesNo(page.videoLink)}`,
    `Media file: ${probe.media ?? 'not tried'}`,
    `Data fields seen: ${page.keysSeen.join(', ') || 'none'}`,
  );
  return lines;
}
