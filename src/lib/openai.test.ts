import { describe, it, expect, vi } from 'vitest';
import { captionFromShare, checkAddresses, extractVenuesFromLink, hasSourceAddress, mentionedInSource, NO_CAPTION_MESSAGE, normalizeType, setCreditPrompt, usableAddress, withoutKnownVenues, type ExtractedVenueItem } from './openai';

// Google lookups for checkAddresses: answers by venue name, so each test says
// what Google "knows". Unknown names find nothing.
const known = new Map<string, { address: string; lat: number; lon: number; types: string[] }>();
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
  const query = JSON.parse(String(init?.body ?? '{}')).address as string;
  const hit = [...known.entries()].find(([name]) => query.startsWith(name));
  return new Response(JSON.stringify(hit ? hit[1] : { lat: null, lon: null }), { status: 200 });
}));
const venue = (name: string, address: string): ExtractedVenueItem =>
  ({ name, address, type: 'food', order: 1, tags: [], lat: null, lon: null });
import type { SavedVenue } from './supabase';

/**
 * The model returns free text; this is the gate that turns it into one of the
 * three types the rest of the app can rely on. Everything downstream — the
 * vibe filter, the default stop time, the itinerary composition — keys off it.
 */
it('reports an extraction rate limit without prompting for a credit', async () => {
  const prompt = vi.fn();
  setCreditPrompt(prompt);
  try {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ code: 'rate_limit' }, { status: 429 }));
    await expect(extractVenuesFromLink('https://www.instagram.com/reel/test/'))
      .rejects.toThrow('Too many AI requests. Try again shortly.');
    expect(prompt).not.toHaveBeenCalled();
  } finally {
    setCreditPrompt(null);
  }
});

/**
 * AI Save must tell "the service refused or failed" from "this link has no
 * venue". Without that, a gate or budget refusal reads as a bad venue.
 */
describe('AI Save provider failures', () => {
  const link = 'https://www.instagram.com/reel/test/';
  const strict = { verifySeparately: true } as const;

  it.each([
    [401, 'auth'], [403, 'unavailable'], [409, 'busy'], [429, 'limit'], [503, 'unavailable'],
  ])('reports a metadata refusal (HTTP %i) as a provider problem and does not guess a venue', async (status, reason) => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'refused' }, { status }));
    await expect(extractVenuesFromLink(link, strict)).rejects.toMatchObject({ name: 'ProviderUnavailableError', reason, status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps going when a website link itself was rejected as invalid (HTTP 400)', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'bad url' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
    await expect(extractVenuesFromLink('https://test.example/best-cafes', strict)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable metadata service as a provider problem', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(extractVenuesFromLink(link, strict)).rejects.toMatchObject({ name: 'ProviderUnavailableError', reason: 'unavailable' });
  });

  it('reports an AI refusal as a provider problem instead of a generic error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'instagram', url: link, fetched: true, ogDescription: 'Great cafe' }))
      .mockResolvedValueOnce(Response.json({ error: 'refused', code: 'staging_providers_disabled' }, { status: 503 }));
    await expect(extractVenuesFromLink(link, strict)).rejects.toMatchObject({
      name: 'ProviderUnavailableError', reason: 'unavailable', status: 503, code: 'staging_providers_disabled',
    });
  });

  it('still lets other callers carry on without metadata when the metadata service refuses', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'refused' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
    await expect(extractVenuesFromLink(link)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

/**
 * A TikTok or Instagram post whose caption never arrived (TikTok turns some requests away) used to go to the AI with only
 * the link and the creator's name. It then guessed venues the post never named, and Google "confirmed" them.
 */
describe('a social post with no readable caption', () => {
  it.each([
    ['a TikTok video whose caption lookup was turned away', 'https://www.tiktok.com/@sydney_edited/video/123',
      { platform: 'tiktok', contentType: 'video', url: 'https://www.tiktok.com/@sydney_edited/video/123', handle: 'sydney_edited', fetched: false }],
    ['a TikTok photo post with an empty caption', 'https://www.tiktok.com/@someone/photo/456',
      { platform: 'tiktok', contentType: 'video', url: 'https://www.tiktok.com/@someone/photo/456', fetched: true, oembedTitle: '  ' }],
    ['an Instagram reel the metadata service rejected', 'https://www.instagram.com/reel/test/', null],
  ])('stops before the AI for %s, and says to try again or search', async (_case, link, meta) => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(meta ? Response.json(meta) : Response.json({ error: 'bad url' }, { status: 400 }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true })).rejects.toThrow(NO_CAPTION_MESSAGE);
    // Only the metadata request: no AI call, so nothing is guessed and nothing is spent.
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('still asks the AI when only the place the creator tagged came through', async () => {
    const link = 'https://www.tiktok.com/@someone/video/789';
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'tiktok', contentType: 'video', url: link, fetched: true,
      location: { name: 'Ocean Royale', address: 'Auburn NSW', kind: 'poi' } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
    await extractVenuesFromLink(link, { verifySeparately: true, search: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still asks the AI for a profile, and for callers other than AI Save', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'tiktok', contentType: 'profile', url: 'https://www.tiktok.com/@cafe', fetched: false }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }))
      .mockResolvedValueOnce(Response.json({ platform: 'tiktok', contentType: 'video', url: 'https://www.tiktok.com/@a/video/1', fetched: false }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
    await extractVenuesFromLink('https://www.tiktok.com/@cafe', { verifySeparately: true, search: false });
    await extractVenuesFromLink('https://www.tiktok.com/@a/video/1');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

/**
 * When you share a TikTok to The Unsaved, TikTok puts the caption beside the link. That text comes from the phone, so it is
 * there even when TikTok turns our server away.
 */
describe('the caption TikTok sends with a share', () => {
  const link = 'https://vt.tiktok.com/ZSsFTaXA9/';
  const shared = 'Best yum cha in Sydney\n\u{1F4CD} Ocean Royale at Club Auburn\n12-14 Northumberland Road, Auburn NSW 2144 ' + link;
  const blocked = () => Response.json({ platform: 'tiktok', contentType: 'video', url: link, fetched: false });
  const prompt = () => String(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).messages[1].content);

  it('takes the caption out of the shared text, without the link', () => {
    expect(captionFromShare('Korean fusion burgers \u{1F354} https://vt.tiktok.com/ZSbaLC6gH/')).toBe('Korean fusion burgers \u{1F354}');
    expect(captionFromShare('https://vt.tiktok.com/ZSbaLC6gH/')).toBe('');
    expect(captionFromShare(undefined)).toBe('');
  });

  it('reads the venue from the shared caption when TikTok turned the server away', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(blocked())
      .mockResolvedValueOnce(aiVenues({ name: 'Ocean Royale', address: '12-14 Northumberland Road, Auburn NSW 2144', type: 'food' }));
    const progress = { sharedText: shared };
    // The name exactly as the creator wrote it; the Google check then matches it to the listing.
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress })).resolves.toMatchObject([
      { name: 'Ocean Royale at Club Auburn', address: '12-14 Northumberland Road, Auburn NSW 2144' },
    ]);
    expect(prompt()).toContain('Ocean Royale at Club Auburn');
    expect(prompt()).not.toContain('vt.tiktok.com/ZSsFTaXA9/ ');
    // The shared caption counts as the creator's own words: the address is source-backed for the Google check.
    expect(hasSourceAddress(progress, '12-14 Northumberland Road, Auburn NSW 2144')).toBe(true);
    expect(mentionedInSource(progress, 'Ocean Royale')).toBe(true);
    expect(mentionedInSource(progress, 'Oyama Ramen')).toBe(false);
  });

  it('carries on with the shared caption when the metadata service itself fails', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'refused' }, { status: 503 }))
      .mockResolvedValueOnce(aiVenues({ name: 'Ocean Royale', address: '12-14 Northumberland Road, Auburn NSW 2144', type: 'food' }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress: { sharedText: shared } })).resolves.toHaveLength(1);
    expect(prompt()).toContain('Ocean Royale');
  });

  it('prefers the full caption the server read over the shared text', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'tiktok', contentType: 'video', url: link, fetched: true,
      oembedTitle: 'The whole caption: \u{1F4CD} Golden Sands, Hurstville' }))
      .mockResolvedValueOnce(aiVenues());
    await extractVenuesFromLink(link, { verifySeparately: true, progress: { sharedText: 'A shorter shared text ' + link } });
    expect(prompt()).toContain('Golden Sands');
    expect(prompt()).not.toContain('A shorter shared text');
  });

  it('still stops when only the link was shared and the server got nothing', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(blocked());
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress: { sharedText: link } })).rejects.toThrow(NO_CAPTION_MESSAGE);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('whether the post itself names a venue', () => {
  const progress = (caption: string, extra: Record<string, unknown> = {}) => ({ metadata: {
    platform: 'tiktok', contentType: 'video', url: 'https://www.tiktok.com/@a/video/1', ogTitle: null, ogDescription: null,
    ogSiteName: null, pageTitle: null, metaDescription: null, jsonLd: null, handle: null, rawText: null, oembedTitle: caption,
    oembedAuthor: null, oembedHtml: null, fetched: true, ...extra,
  } });
  const oceanRoyale = progress('My top 3 favourites are in the video!\n\u{1F4CD}Ocean Royale at Club Auburn!\nlocated inside Club Auburn at 12-14 Northumberland Road, Auburn, NSW 2144');
  const palace = progress('3. The Palace restaurant in the city.\n2. Feng You in Hurstville.\n1. Golden Sands, which is also in Hurstville.');

  it('does not count a venue the AI found elsewhere, even a real one', () => {
    expect(mentionedInSource(oceanRoyale, 'Oyama Ramen')).toBe(false);
    expect(mentionedInSource(oceanRoyale, 'Gacha Cafe')).toBe(false);
    expect(mentionedInSource(palace, 'Ame')).toBe(false);
    expect(mentionedInSource(palace, 'Loa')).toBe(false);
  });

  it('counts the venues the caption names, including the longer names Google gives them', () => {
    expect(mentionedInSource(oceanRoyale, 'Ocean Royale')).toBe(true);
    expect(mentionedInSource(oceanRoyale, 'Ocean Royale Chinese Restaurant Auburn')).toBe(true);
    expect(mentionedInSource(palace, 'The Palace Chinese Restaurant')).toBe(true);
    expect(mentionedInSource(palace, 'Feng You')).toBe(true);
    expect(mentionedInSource(palace, 'Golden Sands Restaurant')).toBe(true);
  });

  it('counts a name in the joined-up creator handle', () => {
    expect(mentionedInSource(progress('So good', { handle: 'certifiedpizzastmarys' }), 'Certified Pizza St Marys')).toBe(true);
  });

  it('accepts either the AI name or the Google name', () => {
    expect(mentionedInSource(oceanRoyale, 'Oyama Ramen', 'Ocean Royale')).toBe(true);
  });

  it('changes nothing when there is no post text to compare with', () => {
    expect(mentionedInSource(undefined, 'Anything')).toBe(true);
    expect(mentionedInSource({ metadata: { ...progress('').metadata, platform: 'website' } }, 'Anything')).toBe(true);
    expect(mentionedInSource(progress(''), 'Anything')).toBe(true);
  });
});

it('uses one complete first-party structured venue without asking AI', async () => {
  const link = 'https://test.example/venue';
  const schema = {
    '@type': 'Restaurant', name: 'Test Cafe', url: link,
    address: { streetAddress: '1 Test St', addressLocality: 'Sydney', addressRegion: 'NSW', postalCode: '2000' },
  };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'website', url: link, jsonLd: JSON.stringify(schema) }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
    { name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000' },
  ]);
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not treat an unattributed social address as source evidence', async () => {
  const link = 'https://www.instagram.com/reel/test/';
  const progress = {};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    url: link, platform: 'instagram', fetched: true,
    ogDescription: 'Find us at 1 Test St, Sydney NSW 2000!',
  })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
  await extractVenuesFromLink(link, { verifySeparately: true, progress });
  expect(hasSourceAddress(progress, '1 Test St, Sydney NSW 2000, Australia')).toBe(false);
  expect(hasSourceAddress(progress, '11 Test St, Sydney NSW 2000')).toBe(false);
});

const socialLinks = {
  instagram: 'https://www.instagram.com/reel/test/',
  tiktok: 'https://vt.tiktok.com/test/',
};
const fullAddress = '1 Test St, Sydney NSW 2000';
const aiVenues = (...venues: Array<{ name: string; address: string; type: string }>) =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ venues }) } }] });

it.each([
  ['instagram', 'ogDescription', 'Venue: Test Cafe\nAddress: ' + fullAddress],
  ['tiktok', 'oembedTitle', '\u{1F4CD} Test Cafe, ' + fullAddress + ' #sydneyfood'],
] as const)('extracts a complete %s caption without AI', async (platform, field, caption) => {
  const link = socialLinks[platform];
  const progress = {};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform, url: link, [field]: caption }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true, progress }))
    .resolves.toMatchObject([{ name: 'Test Cafe', address: fullAddress, type: 'food' }]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(hasSourceAddress(progress, fullAddress + ', Australia')).toBe(true);
});

describe('an address the AI did not really give', () => {
  const link = 'https://www.instagram.com/reel/test/';

  it.each([
    'Shop location not explicitly provided in caption; externally known address: Strathfield, NSW, Australia (near Strathfield Station). Use full street address if known from source: not provided.',
    'Not provided', 'unknown', 'N/A', 'Address not specified in the caption', 'x'.repeat(201),
  ])('counts %#: that text as no address', address => {
    expect(usableAddress(address)).toBe('');
  });

  it.each([
    '1/1-3 The Boulevarde, Strathfield NSW', 'Chatswood, NSW', '215B Nguyen Trai, Cau Ong Lanh, Ho Chi Minh City, Vietnam',
    'Unknown Pleasures Road, Sydney', 'Know How Lane, Newtown NSW',
  ])('keeps a real address %#: %s', address => {
    // Only filler and bare placeholders are dropped, never a real street that contains one of those words.
    expect(usableAddress(address)).toBe(address);
  });

  it('gives a venue with filler text no address, so the next step (a search or the web AI) runs', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'instagram', url: link, fetched: true, ogDescription: 'Dumplings' }))
      .mockResolvedValueOnce(aiVenues({ name: 'Daruma Dumpling Beer House', address: 'Shop location not explicitly provided in caption; externally known address: Strathfield, NSW. Use full street address if known from source: not provided.', type: 'food' }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true, search: false }))
      .resolves.toMatchObject([{ name: 'Daruma Dumpling Beer House', address: '' }]);
  });
});

describe('the plain AI and the AI with web search', () => {
  const link = 'https://www.instagram.com/reel/test/';
  const meta = () => Response.json({ platform: 'instagram', url: link, fetched: true, ogDescription: 'Cafe in Chatswood' });
  const aiRequest = () => JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));

  it('asks the plain model, and tells it not to search, when search is false', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(meta()).mockResolvedValueOnce(aiVenues({ name: 'Cafe', address: 'Chatswood', type: 'food' }));
    await extractVenuesFromLink(link, { verifySeparately: true, search: false });
    const request = aiRequest();
    expect(request.model).toBe('openai/gpt-4o-mini');
    expect(request.messages[0].content).toContain('cannot search the web');
    expect(request.messages[0].content).not.toContain('web search when useful');
  });

  it('keeps the server default model, and the search instructions, otherwise', async () => {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(meta()).mockResolvedValueOnce(aiVenues({ name: 'Cafe', address: 'Chatswood', type: 'food' }));
    await extractVenuesFromLink(link, { verifySeparately: true });
    const request = aiRequest();
    expect(request).not.toHaveProperty('model');
    expect(request.messages[0].content).toContain('web search when useful');
  });
});

describe('free evidence for venues with no street address', () => {
  const link = 'https://www.instagram.com/reel/test/';

  it('uses the suburb a TikTok creator tagged, so Google can be asked by name', async () => {
    const tiktok = 'https://vt.tiktok.com/test/';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      platform: 'tiktok', url: tiktok, fetched: true, oembedTitle: 'free drink at @Makers Daily',
      location: { name: 'Chatswood', address: 'New South Wales, Australia', kind: 'Other Places' },
    })).mockResolvedValueOnce(aiVenues({ name: 'Makers Daily', address: '', type: 'food' }));
    await expect(extractVenuesFromLink(tiktok, { verifySeparately: true }))
      .resolves.toMatchObject([{ name: 'Makers Daily', address: 'Chatswood, New South Wales, Australia' }]);
  });

  it('reads the address from the venue\'s own Instagram profile when the caption only has its @handle', async () => {
    const progress = {};
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      platform: 'instagram', url: link, fetched: true, handle: 'foodie', ogDescription: 'Banh mi at @duchuongsandwiches so good',
    })).mockResolvedValueOnce(aiVenues({ name: 'Du Chuong Sandwiches', address: '', type: 'food' }))
      .mockResolvedValueOnce(Response.json({
        platform: 'instagram', url: 'https://www.instagram.com/duchuongsandwiches/', fetched: true,
        ogDescription: '1,200 Followers, 10 Following, 40 Posts - Du Chuong Sandwiches (@duchuongsandwiches) on Instagram: "Banh mi Shop 3/45 Bunnerong Rd, Eastgardens NSW | Open daily"',
      }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress }))
      .resolves.toMatchObject([{ name: 'Du Chuong Sandwiches', address: 'Shop 3/45 Bunnerong Rd, Eastgardens NSW' }]);
    expect(String(vi.mocked(fetch).mock.calls[2][1]?.body)).toContain('instagram.com/duchuongsandwiches/');
    expect(hasSourceAddress(progress, 'Shop 3/45 Bunnerong Rd, Eastgardens NSW')).toBe(true);
  });

  it('keeps a venue without evidence as it is when the profile cannot be read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      platform: 'instagram', url: link, fetched: true, ogDescription: 'Banh mi at @duchuongsandwiches',
    })).mockResolvedValueOnce(aiVenues({ name: 'Du Chuong Sandwiches', address: '', type: 'food' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true }))
      .resolves.toMatchObject([{ name: 'Du Chuong Sandwiches', address: '' }]);
  });

  it('takes a street address written for another country as the source address', async () => {
    const progress = {};
    const address = '215B Nguyen Trai, Cau Ong Lanh, Ho Chi Minh City, Vietnam';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      platform: 'instagram', url: link, fetched: true, ogDescription: 'Venue: Tran Pizza\nAddress: ' + address,
    })).mockResolvedValueOnce(aiVenues({ name: 'Tran Pizza', address: '', type: 'food' }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress }))
      .resolves.toMatchObject([{ name: 'Tran Pizza', address }]);
    expect(hasSourceAddress(progress, address)).toBe(true);
  });
});

it.each(['&#x2028;', '&#8232;', '\r\n'])('extracts the NGLE Cafe pin and postcode-free address with line break %j', async (lineBreak) => {
  const link = 'https://www.instagram.com/reel/DZmLwlpNQcs/';
  const ogDescription = 'Pho dipped focaccia in Sydney?! &#x1f92f; &#064;ngle.cafe in Bonnyrigg is a family-owned Vietnamese cafe putting a modern twist on traditional Vietnamese favourites.\n\n&#x1f4cd; NGLE Cafe' + lineBreak + '5 Rigg Pl, Bonnyrigg NSW \n\nWhat we tried:&#x2028;Pho-caccia $20';
  const progress = {};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'instagram', url: link, ogDescription }));

  await expect(extractVenuesFromLink(link, { verifySeparately: true, progress })).resolves.toMatchObject([
    { name: 'NGLE Cafe', address: '5 Rigg Pl, Bonnyrigg NSW', type: 'food' },
  ]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(hasSourceAddress(progress, '5 Rigg Pl, Bonnyrigg NSW')).toBe(true);
  expect(hasSourceAddress(progress, '15 Rigg Pl, Bonnyrigg NSW')).toBe(false);
});

it('uses the flattened Instagram captioned-embed response without AI', async () => {
  const link = 'https://www.instagram.com/reel/DZmLwlpNQcs/';
  const progress = {};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'instagram', contentType: 'reel', url: link, handle: null, fetched: true,
    ogDescription: 'Pho dipped focaccia in Sydney?! NGLE Cafe in Bonnyrigg. 📍 NGLE Cafe 5 Rigg Pl, Bonnyrigg NSW What we tried: Pho-caccia $20',
  }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true, progress })).resolves.toMatchObject([
    { name: 'NGLE Cafe', address: '5 Rigg Pl, Bonnyrigg NSW', type: 'food' },
  ]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(hasSourceAddress(progress, '5 Rigg Pl, Bonnyrigg NSW')).toBe(true);
});

it('does not choose one pin from a flattened multi-venue caption', async () => {
  const link = socialLinks.instagram;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'instagram', url: link, fetched: true,
    ogDescription: '📍 Test Cafe 1 Test St, Sydney NSW 2000 📍 Other Bar 8 Other Rd, Sydney NSW 2000',
  })).mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
    { name: 'Test Cafe', requiresManualCorrection: true },
  ]);
});

describe('a caption address that leaves the state off', () => {
  const link = socialLinks.instagram;
  const caption = 'This is a tiny family owned pizza spot.\n\n\u{1F4CD} Certified Pizza\n5 Crana St, St Marys\n\nInvite #westernsydney #pizza';
  const meta = (ogDescription: string) => Response.json({ platform: 'instagram', url: link, fetched: true, ogDescription });
  const evidence = () => String(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).messages[1].content);

  it('reads the name and street under a pin, gives them to the AI as evidence, and counts them as written by the creator', async () => {
    const progress = {};
    vi.mocked(fetch).mockResolvedValueOnce(meta(caption))
      .mockResolvedValueOnce(aiVenues({ name: 'Certified Pizza', address: '5 Crana St, St Marys NSW 2760', type: 'food' }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true, progress })).resolves.toMatchObject([
      { name: 'Certified Pizza', address: '5 Crana St, St Marys', type: 'food' },
    ]);
    expect(evidence()).toContain('Caption evidence (unverified source data): {"name":"Certified Pizza","address":"5 Crana St, St Marys"');
    expect(hasSourceAddress(progress, '5 Crana St, St Marys')).toBe(true);
    expect(hasSourceAddress(progress, '15 Crana St, St Marys')).toBe(false);
  });

  it('keeps the venue the caption names when the AI names a different one, and asks for a check', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(meta(caption))
      .mockResolvedValueOnce(aiVenues({ name: 'Dandelion Garden', address: '123 Pickford St, Burwood East VIC 3151', type: 'activity' }));
    const [venue] = await extractVenuesFromLink(link, { verifySeparately: true });
    expect(venue).toMatchObject({ name: 'Certified Pizza', address: '5 Crana St, St Marys', requiresManualCorrection: true });
  });

  it('still ignores a second line that is only a suburb, so nothing is invented', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(meta('\u{1F4CD} Certified Pizza\nSt Marys\n#pizza'))
      .mockResolvedValueOnce(aiVenues());
    await extractVenuesFromLink(link, { verifySeparately: true });
    expect(evidence()).not.toContain('Caption evidence');
  });

  it('does not pick one venue when the caption pins two', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(meta('\u{1F4CD} Test Cafe\n1 Test St, Newtown\n\u{1F4CD} Other Bar\n2 Other Rd, Enmore'))
      .mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));
    await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
      { requiresManualCorrection: true },
    ]);
  });
});

it('keeps the source evidence in a fallback request below the staging byte limit', async () => {
  const link = socialLinks.tiktok;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    url: link, platform: 'tiktok', fetched: true,
    oembedTitle: 'Venue: Test Cafe\nLocation: Sydney NSW\n' + '\u{1f30f}"\\'.repeat(3000),
    ogDescription: 'x'.repeat(3000), ogTitle: '\u{1f4cd}'.repeat(1000),
    jsonLd: '\u{1f4cd}'.repeat(5000), rawText: 'UNRELATED_PAGE_NAVIGATION'.repeat(1000),
  })).mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));

  await extractVenuesFromLink(link, { verifySeparately: true });
  const { messages } = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const serialized = JSON.stringify(messages);
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(8000);
  expect(messages[1].content).toContain('Caption evidence (unverified source data): {"name":"Test Cafe","locality":"Sydney NSW"');
  expect(messages[1].content).not.toContain('UNRELATED_PAGE_NAVIGATION');
});

it('bounds serialized multibyte article metadata while retaining the venue clue', async () => {
  const link = 'https://test.example/venue';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    url: link, platform: 'website', ogTitle: 'Test Cafe',
    rawText: 'Test Cafe in Sydney. ' + '旅'.repeat(4000),
  })).mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));

  await extractVenuesFromLink(link, { verifySeparately: true });
  const { messages } = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  const bytes = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  expect(bytes).toBeLessThan(8000);
  expect(messages[1].content).toContain('Article excerpt: Test Cafe in Sydney.');
});

it('flags the Jayco hike list for manual review even when AI picks one trail', async () => {
  const link = 'https://www.jayco.com.au/community/article/top-5-hikes-in-australia';
  const title = 'Top 5 Hikes in Australia';
  const rawText = title + ' UNRELATED_MENU '.repeat(400) + title +
    ' 1. Cape to Cape Track, Margaret River WA 2. Great Ocean Walk, VIC 3. K’Gari Great Walk, QLD' +
    ' 4. Blue Gum Forest, Blue Mountains NSW 5. Wineglass Bay Circuit, TAS';
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    url: link, platform: 'website', fetched: true, ogTitle: title + ' - Jayco', rawText,
  })).mockResolvedValueOnce(aiVenues({ name: 'Cape to Cape Track', address: 'Margaret River, WA', type: 'outdoors' }));

  await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
    { name: 'Cape to Cape Track', requiresManualCorrection: true },
  ]);
  const { messages } = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
  expect(messages[1].content).toContain('Wineglass Bay Circuit');
  expect(messages[1].content).not.toContain('UNRELATED_MENU');
});

it('fills missing caption fields while retaining source identity across a retry', async () => {
  const link = socialLinks.tiktok;
  const progress = {};
  const options = { verifySeparately: true, progress };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'tiktok', url: link, oembedTitle: 'Venue: Test Cafe\nLocation: Sydney NSW',
  })).mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(aiVenues({ name: 'test cafe', address: fullAddress, type: 'bar' }));
  await expect(extractVenuesFromLink(link, options)).rejects.toThrow('AI request failed (502)');
  await expect(extractVenuesFromLink(link, options))
    .resolves.toMatchObject([{ name: 'Test Cafe', address: fullAddress, type: 'food' }]);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(String(vi.mocked(fetch).mock.calls[2][1]?.body)).toContain('Caption evidence');
  expect(hasSourceAddress(progress, fullAddress)).toBe(false);
});

it.each([
  ['Different Cafe', fullAddress],
  ['Test Cafe', '99 Test Rd, Parramatta NSW 2150'],
])('sends conflicting AI identity or branch to correction (%s)', async (name, address) => {
  const link = socialLinks.instagram;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'instagram', url: link, ogDescription: 'Venue: Test Cafe\nLocation: Sydney NSW',
  })).mockResolvedValueOnce(aiVenues({ name, address, type: 'food' }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
    { name: 'Test Cafe', address: 'Sydney NSW', requiresManualCorrection: true },
  ]);
});

it('does not promote a promotional address from separate metadata to venue evidence', async () => {
  const link = socialLinks.instagram;
  const progress = {};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'instagram', url: link, ogDescription: 'Venue: Test Cafe',
    metaDescription: 'Address: ' + fullAddress + '\n#sponsored',
  })).mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true, progress })).resolves.toMatchObject([
    { name: 'Test Cafe', requiresManualCorrection: true },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(hasSourceAddress(progress, fullAddress)).toBe(false);
});

it('requires correction if AI returns only one venue from a multi-venue caption', async () => {
  const link = socialLinks.tiktok;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    platform: 'tiktok', url: link,
    oembedTitle: 'Venue: Test Cafe\nAddress: ' + fullAddress + '\nVenue: Other Bar',
  })).mockResolvedValueOnce(aiVenues({ name: 'Test Cafe', address: fullAddress, type: 'food' }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true })).resolves.toMatchObject([
    { name: 'Test Cafe', requiresManualCorrection: true },
  ]);
});

it('uses AI for ambiguous metadata and preserves a partial candidate for manual correction', async () => {
  const link = 'https://test.example/list';
  const schema = [
    { '@type': 'Restaurant', name: 'First Cafe' },
    { '@type': 'Restaurant', name: 'Second Cafe' },
  ];
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ platform: 'website', url: link, jsonLd: JSON.stringify(schema) }))
    .mockResolvedValueOnce(Response.json({
      choices: [{ message: { content: JSON.stringify({ venues: [{ name: 'First Cafe', type: 'food' }] }) } }],
    }));
  await expect(extractVenuesFromLink(link, { verifySeparately: true }))
    .resolves.toMatchObject([{ name: 'First Cafe', address: '' }]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('reuses fetched metadata if the AI request must be retried', async () => {
  const link = 'https://test.example/reel';
  const options = { verifySeparately: true, progress: {} };
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ platform: 'website', url: link, fetched: true }))
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"venues":[]}' } }] }));
  await expect(extractVenuesFromLink(link, options)).rejects.toThrow('AI request failed (502)');
  await expect(extractVenuesFromLink(link, options)).resolves.toEqual([]);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/extract-venue-meta'))).toHaveLength(1);
});

describe('normalizeType', () => {
  it('accepts the four canonical values', () => {
    expect(normalizeType('food')).toBe('food');
    expect(normalizeType('activity')).toBe('activity');
    expect(normalizeType('dessert')).toBe('dessert');
    expect(normalizeType('bar')).toBe('bar');
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeType('  FOOD  ')).toBe('food');
    expect(normalizeType('Dessert')).toBe('dessert');
  });

  it('maps food synonyms', () => {
    for (const s of ['restaurant', 'a great cafe', 'dinner spot', 'somewhere to eat']) {
      expect(normalizeType(s)).toBe('food');
    }
  });

  it('maps bar synonyms to bar, not food', () => {
    // "bar" was a food keyword until the 4th type was added; a wine bar is
    // now its own thing.
    for (const s of ['wine bar', 'cocktail lounge', 'a pub', 'brewery', 'drinks', 'nightclub']) {
      expect(normalizeType(s)).toBe('bar');
    }
  });

  it('maps activity synonyms', () => {
    for (const s of ['escape room', 'fun activity', 'an experience', 'mini golf game', 'sports']) {
      expect(normalizeType(s)).toBe('activity');
    }
  });

  it('maps dessert synonyms', () => {
    for (const s of ['gelato', 'ice creamery', 'cake shop', 'bakery', 'something sweet']) {
      expect(normalizeType(s)).toBe('dessert');
    }
  });

  it('classifies dessert bars as dessert, not food', () => {
    // Regression: the food branch matches on "bar", so when it ran first these
    // came back as food — contradicting the extraction prompt, which defines a
    // dessert bar as a dessert venue.
    expect(normalizeType('dessert bar')).toBe('dessert');
    expect(normalizeType('ice cream bar')).toBe('dessert');
  });

  it('rejects anything it cannot place', () => {
    expect(normalizeType('museum')).toBeNull();
    expect(normalizeType('')).toBeNull();
    expect(normalizeType(null)).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
    expect(normalizeType(42)).toBeNull();
    expect(normalizeType({ type: 'food' })).toBeNull();
  });
});

/**
 * "Something New" must be new: the model is asked to skip saved and visited
 * places, but this is what actually guarantees it.
 */
describe('withoutKnownVenues', () => {
  const saved = [
    { id: '1', name: 'Bar Lune', address: '123 Collins St, Melbourne VIC 3000', link: 'https://instagram.com/barlune', lat: null, lon: null },
  ] as unknown as SavedVenue[];
  const history = [{ title: 'Friday', date: '2026-09-20', location: 'Fitzroy', stops: [{ name: 'Gelato Lab', address: '210 Brunswick St, Fitzroy VIC 3065', type: 'dessert' }] }];
  const candidate = (name: string, address: string, vibe_link: string | null = null) => ({ name, address, type: 'food' as const, vibe_link });

  it('drops a suggestion the user has already saved, however it is written', () => {
    const out = withoutKnownVenues([candidate('bar lune', '123 Collins Street, Melbourne'), candidate('Pho Nom', '45 Swanston St, Melbourne')], saved);
    expect(out.map((c) => c.name)).toEqual(['Pho Nom']);
  });

  it('drops a place from a recent night out', () => {
    const out = withoutKnownVenues([candidate('Gelato Lab', '210 Brunswick St, Fitzroy'), candidate('Messina', '237 Smith St, Fitzroy')], [], history);
    expect(out.map((c) => c.name)).toEqual(['Messina']);
  });

  it('drops a suggestion that links to a saved venue', () => {
    const out = withoutKnownVenues([candidate('Lune Bar', 'Melbourne', 'instagram.com/barlune/')], saved);
    expect(out).toEqual([]);
  });

  it('keeps everything when the user has nothing saved or visited', () => {
    const list = [candidate('A', '1 A St'), candidate('B', '2 B St')];
    expect(withoutKnownVenues(list, [], [])).toEqual(list);
  });
});

/**
 * The AI finds venue names in any language but not always their addresses: a
 * Japanese reel of 7 Tokyo cafés came back with one address on all 7, or
 * invented ones. Those are looked up by name; the rest are left alone.
 */
describe('checkAddresses', () => {
  it('replaces made-up overseas addresses with the real ones', async () => {
    known.clear();
    known.set('茶亭 羽當', { address: '1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan', lat: 35.66, lon: 139.70, types: ['establishment', 'cafe'] });
    const items = [venue('茶亭 羽當 (Chatei Hatou)', '1-1-1 Shibuya, Shibuya City, Tokyo 150-0002, Japan')];
    await checkAddresses(items);
    expect(items[0].address).toBe('1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan');
    expect(items[0].lat).toBe(35.66);
  });

  it('never leaves one address on several venues', async () => {
    known.clear();
    known.set('Cafe A', { address: '2-14-1 Kamimeguro, Meguro City, Tokyo 153-0051, Japan', lat: 1, lon: 1, types: ['establishment'] });
    const same = '1-1-1 Shibuya, Shibuya City, Tokyo, Japan';
    const items = [venue('Cafe A', same), venue('Cafe B', same)];
    await checkAddresses(items);
    expect(items[0].address).toContain('Kamimeguro');
    // Not found: cut back to the area rather than sending people to the wrong door.
    expect(items[1].address).toBe('Shibuya City, Tokyo, Japan');
    expect(items[1].lat).toBeNull();
  });

  it('ignores a park or neighbourhood matched instead of the venue', async () => {
    known.clear();
    known.set('Fuglen Tokyo', { address: 'Yoyogi Park, 2-1 Yoyogikamizonocho, Shibuya, Tokyo 151-0052, Japan', lat: 1, lon: 1, types: ['establishment', 'park'] });
    const items = [venue('Fuglen Tokyo', '1-16-11 Tomigaya, Shibuya City, Tokyo, Japan')];
    await checkAddresses(items);
    expect(items[0].address).toBe('1-16-11 Tomigaya, Shibuya City, Tokyo, Japan');
  });

  it('trusts an Australian street address the AI found', async () => {
    known.clear();
    known.set('Bar Lune', { address: '9 Other St, Somewhere VIC 3000', lat: 1, lon: 1, types: ['establishment'] });
    const items = [venue('Bar Lune', '123 Collins St, Melbourne VIC 3000')];
    await checkAddresses(items);
    expect(items[0].address).toBe('123 Collins St, Melbourne VIC 3000');
  });
});
