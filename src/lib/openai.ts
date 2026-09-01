import type { VenueType, SavedVenue } from './supabase';
import { isGoogleMapsLink, resolveGoogleMapsLink } from './apiKeys';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function callAI(
  messages: ChatMessage[],
  opts?: { temperature?: number; responseFormat?: 'json_object' }
): Promise<string> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-proxy`;
  const body: Record<string, unknown> = {
    messages,
    temperature: opts?.temperature ?? 0,
  };
  if (opts?.responseFormat) body.response_format = { type: opts.responseFormat };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}). ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from AI.');
  return content as string;
}

export type ExtractedVenue = {
  name: string | null;
  address: string | null;
  type: VenueType | null;
  tags: string[];
  lat?: number | null;
  lon?: number | null;
};

export type ExtractedVenueItem = {
  name: string;
  address: string;
  type: VenueType;
  order: number;
  lat?: number | null;
  lon?: number | null;
  tags: string[];
};

export type VenueCandidate = {
  name: string;
  address: string;
  type: VenueType;
  vibe_link: string | null;
};

const VALID_TYPES: VenueType[] = ['food', 'activity', 'dessert'];

function normalizeType(raw: unknown): VenueType | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase().trim();
  if (VALID_TYPES.includes(lower as VenueType)) return lower as VenueType;
  if (lower.includes('food') || lower.includes('restaurant') || lower.includes('dinner') || lower.includes('cafe') || lower.includes('bar') || lower.includes('eat')) return 'food';
  if (lower.includes('activity') || lower.includes('adventure') || lower.includes('experience') || lower.includes('escape') || lower.includes('game') || lower.includes('sport')) return 'activity';
  if (lower.includes('dessert') || lower.includes('sweet') || lower.includes('cake') || lower.includes('ice cream') || lower.includes('gelato') || lower.includes('bakery')) return 'dessert';
  return null;
}

type MetaResult = {
  platform: string;
  contentType: string;
  url: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  pageTitle: string | null;
  metaDescription: string | null;
  jsonLd: string | null;
  handle: string | null;
  rawText: string | null;
  oembedTitle: string | null;
  oembedAuthor: string | null;
  oembedHtml: string | null;
  fetched: boolean;
};

async function fetchPageMeta(url: string): Promise<MetaResult | null> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-venue-meta`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return data as MetaResult;
  } catch {
    return null;
  }
}

function buildExtractionPrompt(meta: MetaResult | null, link: string): string {
  const contentType = meta?.contentType ?? 'unknown';
  const platform = meta?.platform ?? 'unknown';

  if (!meta || !meta.fetched) {
    // Could not fetch page content — rely on URL + handle + oEmbed + web search
    let clueText = `URL: ${link}\nPlatform: ${platform}\nContent type: ${contentType}`;
    if (meta?.handle) clueText += `\nExtracted handle/username: ${meta.handle}`;
    if (meta?.oembedTitle) {
      const isUrl = /^https?:\/\//.test(meta.oembedTitle);
      if (isUrl) {
        clueText += `\nPost permalink (from oEmbed): ${meta.oembedTitle}`;
      } else {
        clueText += `\nVideo/post caption (from oEmbed): ${meta.oembedTitle}`;
      }
    }
    if (meta?.oembedAuthor) clueText += `\nVideo/post author: ${meta.oembedAuthor}`;

    if (contentType === 'reel' || contentType === 'video') {
      clueText += `\n\nIMPORTANT: This is a ${contentType} on ${platform}. There are TWO possibilities:\n1. The ${contentType} is posted BY the venue itself (the creator IS the venue). Many venues post their own reels/videos. If the creator name "${meta?.handle ?? 'unknown'}" sounds like a business name (restaurant, cafe, bar, etc.), treat it as the venue name and search for it plus "address" or "location".\n2. The ${contentType} features or reviews one or more venues. Look for @ mentions, location hashtags, or venue names in the caption.\n${meta?.oembedTitle && !/^https?:\/\//.test(meta.oembedTitle) ? `The video caption is: "${meta.oembedTitle}". ` : ''}${meta?.oembedTitle && /^https?:\/\//.test(meta.oembedTitle) ? `The post permalink is: ${meta.oembedTitle}. ` : ''}${meta?.handle ? `The creator is @${meta.handle}. ` : ''}Use web search to find the venue(s). Try these search strategies:\n1. FIRST: Search for "${meta?.handle ?? 'unknown'}" plus "restaurant" or "cafe" or "bar" or "address" — the creator may BE the venue.\n2. Search for the exact URL to find blog posts, articles, or reposts discussing this content.\n3. Search for the creator name plus any keywords from the caption text.\n4. Search for each venue name you find plus "address" to get the full street address.\nTry at least 2-3 different search queries before giving up.`;
    } else if (contentType === 'post') {
      clueText += `\n\nIMPORTANT: This is a post on ${platform}. The post may tag or mention one or more venues. ${meta?.oembedTitle ? `The post caption is: "${meta.oembedTitle}". ` : ''}${meta?.handle ? `The author is @${meta.handle}. ` : ''}Use web search to find what venue(s) are mentioned. Search for the exact URL, or search for the author name plus keywords from the caption. Then search for each venue name plus "address" to find the full address.`;
    } else if (platform === 'instagram' && meta?.handle) {
      clueText += `\n\nIMPORTANT: This appears to be an Instagram profile page. The handle "${meta.handle}" is very likely the venue's name or close to it. Use web search to find this venue:\n1. Search for "${meta.handle}" plus "restaurant" or "cafe" or "bar" or "venue" or "address" — the handle IS likely the venue name.\n2. Search for "${meta.handle}" plus "Instagram" to find directory sites or articles mentioning this account.\n3. Search for "${meta.handle}" plus the city or area if you can infer it from the URL or handle.\nThen search for the venue name plus "address" to find the full street address.`;
    } else if (platform === 'facebook' && meta?.handle) {
      clueText += `\n\nIMPORTANT: This appears to be a Facebook page for "${meta.handle}". Use web search to find this venue:\n1. Search for "${meta.handle}" plus "Facebook" plus "address" or "location".\n2. Search for "${meta.handle}" plus "restaurant" or "cafe" or "venue".\nThen search for the venue name plus "address" to find the full street address.`;
    } else if (platform === 'tiktok' && meta?.handle) {
      clueText += `\n\nIMPORTANT: This appears to be a TikTok from creator "${meta.handle}". The video may tag or mention a venue in its caption. Use web search:\n1. Search for "${meta.handle}" plus "TikTok" plus "restaurant" or "venue" or "food".\n2. Search for the exact URL to find reposts or articles discussing this video.\n3. Search for "${meta.handle}" plus any keywords from the caption.\nThen search for each venue name plus "address" to find the full street address.`;
    } else {
      clueText += `\n\nUse web search to find venue information from this URL. Search for the exact URL to find articles, directory listings, or reviews mentioning this venue. Then search for the venue name plus "address" to find the full street address.`;
    }
    return clueText;
  }

  // Build a context string from all available metadata
  const parts: string[] = [];
  parts.push(`URL: ${link}`);
  parts.push(`Platform: ${meta.platform}`);
  parts.push(`Content type: ${contentType}`);
  if (meta.handle) parts.push(`Handle/username: ${meta.handle}`);
  if (meta.oembedTitle) {
    const isUrl = /^https?:\/\//.test(meta.oembedTitle);
    if (isUrl) {
      parts.push(`Post permalink (from oEmbed): ${meta.oembedTitle}`);
    } else {
      parts.push(`Video/post caption (from oEmbed): ${meta.oembedTitle}`);
    }
  }
  if (meta.oembedAuthor) parts.push(`Video/post author: ${meta.oembedAuthor}`);
  if (meta.ogTitle) parts.push(`Page title (og:title): ${meta.ogTitle}`);
  if (meta.ogDescription) parts.push(`Description (og:description): ${meta.ogDescription}`);
  if (meta.metaDescription && meta.metaDescription !== meta.ogDescription) {
    parts.push(`Meta description: ${meta.metaDescription}`);
  }
  if (meta.jsonLd) parts.push(`Structured data (JSON-LD):\n${meta.jsonLd}`);
  if (meta.rawText) parts.push(`Page text excerpt:\n${meta.rawText}`);

  let context = parts.join('\n\n');

  // Add content-type-specific guidance
  if (contentType === 'reel' || contentType === 'video') {
    const hasCaption = meta.ogDescription || (meta.oembedTitle && !/^https?:\/\//.test(meta.oembedTitle));
    context += `\n\nNOTE: This is a ${contentType} on ${meta.platform}. There are TWO possibilities:\n1. The ${contentType} is posted BY the venue itself — the creator IS the venue. Many venues post their own reels/videos. If the creator name "${meta.handle ?? 'unknown'}" sounds like a business name (restaurant, cafe, bar, etc.), treat it as the venue name and search for "${meta.handle}" plus "address" or "location".\n2. The ${contentType} features or reviews one or more venues. Look for @ mentions, location hashtags, or venue names in the caption.\n${meta.oembedTitle && !/^https?:\/\//.test(meta.oembedTitle) ? `The video caption is: "${meta.oembedTitle}". ` : ''}${meta.oembedTitle && /^https?:\/\//.test(meta.oembedTitle) ? `The post permalink is: ${meta.oembedTitle}. ` : ''}${hasCaption ? `The caption/description above already contains venue names and clues. Extract venue names from the caption FIRST. Then search the web for each venue name plus "address" to find the full street address. Only search for the creator name if the caption does not mention any venue names.` : `The caption is vague or missing. Use web search: first search for the creator name (@${meta.handle ?? 'unknown'}) plus "restaurant" or "cafe" or "address", then search for the exact URL to find blog posts or articles discussing this content. Try 2-3 different search queries.`}`;
  } else if (contentType === 'post') {
    context += `\n\nNOTE: This is a ${meta.platform} post. The caption (og:description) may tag or mention one or more venues. Look for @ mentions, location tags, or venue names in the caption. If the caption mentions a venue name, search the web for that venue name plus "address" to find its full address.`;
  } else if (contentType === 'profile') {
    if (meta.platform === 'instagram') {
      context += `\n\nNOTE: This is an Instagram profile/business page. The handle "${meta.handle}" is often the venue name. The bio (og:description) often contains the address, suburb, or location. Look for address patterns, suburb names, or "Located in" text. If the address is not in the bio, use web search: search for "${meta.handle}" plus "restaurant" or "cafe" or "bar" or "address" or "location". Then search for the venue name plus "address" to find the full street address.`;
    } else if (meta.platform === 'facebook') {
      context += `\n\nNOTE: This is a Facebook page. The page name (og:title) is likely the venue name. Use web search: search for the page name plus "Facebook" plus "address" or "location". Then search for the venue name plus "address" to find the full street address.`;
    } else if (meta.platform === 'tiktok') {
      context += `\n\nNOTE: This is a TikTok creator profile. The creator may feature venues in their videos. Use web search: search for "${meta.handle}" plus "TikTok" plus "restaurant" or "venue" or "food" to find venues they have featured. Then search for each venue name plus "address" to find the full street address.`;
    }
  } else if (contentType === 'website') {
    context += `\n\nNOTE: This is a website. Look for the venue name in the page title, description, or structured data. Look for the address in the page text or structured data.`;
  }

  return context;
}

export async function extractVenuesFromLink(
  link: string
): Promise<ExtractedVenueItem[]> {
  // If this is a Google Maps link, resolve it directly via the Google APIs
  // instead of scraping the page (which mostly returns empty for Maps pages).
  if (isGoogleMapsLink(link)) {
    const place = await resolveGoogleMapsLink(link);
    if (place && (place.name || place.address)) {
      return [{
        name: place.name ?? '',
        address: place.address ?? '',
        type: 'food',
        order: 1,
        lat: place.lat,
        lon: place.lon,
        tags: [],
      }];
    }
    // If resolution failed, fall through to the normal AI-based extraction
  }

  // Step 1: Fetch real page metadata via edge function
  const meta = await fetchPageMeta(link);

  // Step 2: Build context from metadata for the AI
  const context = buildExtractionPrompt(meta, link);

  // Step 3: Ask AI to extract venue details using the metadata + web search
  const content = await callAI(
    [
      {
        role: 'system',
        content:
          "You are a venue research assistant. You will be given metadata extracted from a social media page or video (Instagram, Facebook, TikTok, or a website) including the page title, description, handle, structured data, video caption, and visible text. Your job is to extract venue details from this metadata FIRST. If the metadata contains enough information to identify venue names, addresses, and types, use it directly. If any field is missing or unclear, use web search to find the missing information — search for the venue name or handle plus 'address' or 'location'. CRITICAL for reels/videos: There are TWO possibilities — (1) the reel/video is posted BY the venue itself (the creator IS the venue — many venues post their own reels), or (2) the reel/video features or reviews one or more venues. FIRST check if the creator name sounds like a business name and search for it as a venue. THEN look for other venue names mentioned in the caption, description, hashtags, or @ mentions. IMPORTANT: If the caption or description already contains venue names, extract them directly from the text — do NOT do unnecessary web searches. Only use web search to find the full street address for venues you've already identified from the caption, or to find venues when the caption is vague or missing. The content may mention MULTIPLE distinct venues (e.g. a reel listing 'top 5 spots'). You must identify ALL distinct venues mentioned and return them as a list, ordered by the sequence they appear in the content (first mentioned = order 1, second = order 2, etc.). Do NOT duplicate the same venue. If only one venue is mentioned, return a list with one item. For each venue extract: (1) the venue name, (2) the FULL street address including street number, street name, suburb, state and postcode (e.g. '123 George St, Sydney NSW 2000'), and (3) the venue type which must be exactly one of: 'food', 'activity', or 'dessert'. A restaurant, cafe, bar, or pub is 'food'. An escape room, bowling, arcade, mini-golf, or experience is 'activity'. A gelato shop, cake shop, ice creamery, or dessert bar is 'dessert'. If you can find the venue but only a suburb (no street address), return the suburb as the address. If the metadata is sparse or the page could not be fully fetched, use web search — search for the creator name plus caption text, or search for the full URL to find articles or blog posts discussing the content and the venues it features. For each venue also extract 0-5 short lowercase tags describing the cuisine, style, or vibe (e.g. \"italian\", \"cocktails\", \"rooftop\", \"brunch\", \"korean bbq\", \"craft beer\", \"family-friendly\", \"date-night\"). COORDINATES: If the structured data (JSON-LD), page text, or web search results contain exact latitude and longitude for a venue (e.g. from schema.org GeoCoordinates, a Google Maps link, or a business listing), include them as numeric \"lat\" and \"lon\" fields. Only include coordinates you are confident are for that specific venue — do NOT guess or estimate. If you cannot find exact coordinates, omit lat and lon (or set them to null). Return JSON: {\"venues\": [{\"name\": \"...\", \"address\": \"...\", \"type\": \"food|activity|dessert\", \"order\": 1, \"tags\": [\"...\"], \"lat\": number|null, \"lon\": number|null}]}. If you cannot find any venue, return {\"venues\": []}.",
      },
      { role: 'user', content: context },
    ],
    { temperature: 0, responseFormat: 'json_object' }
  );

  let parsed: { venues?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse venue details from response.');
  }

  const arr = Array.isArray(parsed.venues) ? parsed.venues : [];
  const items: ExtractedVenueItem[] = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const address = typeof obj.address === 'string' ? obj.address.trim() : '';
    if (!name || !address) continue;
    const type = normalizeType(obj.type);
    if (!type) continue;
    const order = typeof obj.order === 'number' ? obj.order : items.length + 1;
    const rawTags = Array.isArray(obj.tags) ? obj.tags : [];
    const tags = rawTags
      .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
      .filter((t) => t.length > 0)
      .slice(0, 5);
    const lat = typeof obj.lat === 'number' && Number.isFinite(obj.lat) ? obj.lat : null;
    const lon = typeof obj.lon === 'number' && Number.isFinite(obj.lon) ? obj.lon : null;
    items.push({ name, address, type, order, tags, lat, lon });
  }

  items.sort((a, b) => a.order - b.order);
  return items;
}

export async function extractVenueFromLink(
  link: string
): Promise<ExtractedVenue> {
  const items = await extractVenuesFromLink(link);
  if (items.length === 0) {
    return { name: null, address: null, type: null, tags: [] };
  }
  const first = items[0];
  return { name: first.name, address: first.address, type: first.type, tags: first.tags, lat: first.lat ?? null, lon: first.lon ?? null };
}

export async function discoverVenueCandidates(
  vibe: VenueType,
  location: string
): Promise<VenueCandidate[]> {
  const vibeLabel =
    vibe === 'food' ? 'restaurants, cafes, bars, or pubs' :
    vibe === 'activity' ? 'activities like escape rooms, bowling, arcade, mini-golf, or experiences' :
    'dessert spots like gelato shops, cake shops, ice creameries, or dessert bars';

  const content = await callAI(
    [
      {
        role: 'system',
        content:
          `You are a local venue discovery assistant for Australia. Use web search to find 8 real, well-known ${vibeLabel} in or very close to "${location}". For each venue return: (1) the venue name, (2) the FULL street address including street number, street name, suburb, state and postcode (e.g. '123 George St, Sydney NSW 2000'), (3) the type which must be exactly '${vibe}', and (4) a link to the venue's Instagram or website if findable, or null. Return a JSON object: {"venues": [{"name": "...", "address": "...", "type": "${vibe}", "vibe_link": "..." or null}]}. Only include real venues that actually exist. Do not invent or hallucinate venues.`,
      },
      { role: 'user', content: `Find ${vibeLabel} near ${location}` },
    ],
    { temperature: 0.7, responseFormat: 'json_object' }
  );

  let parsed: { venues?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse venue candidates from response.');
  }

  const arr = Array.isArray(parsed.venues) ? parsed.venues : [];
  const candidates: VenueCandidate[] = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const address = typeof obj.address === 'string' ? obj.address.trim() : '';
    if (!name || !address) continue;
    const type = normalizeType(obj.type) ?? vibe;
    const link = typeof obj.vibe_link === 'string' && obj.vibe_link.trim() ? obj.vibe_link.trim() : null;
    candidates.push({ name, address, type, vibe_link: link });
  }

  return candidates;
}

export async function discoverSmartVenueCandidates(
  vibes: VenueType[],
  location: string | { lat: number; lon: number },
  savedVenues: SavedVenue[],
  travelTimeMinutes?: number,
  dietaryPreferences?: string[]
): Promise<VenueCandidate[]> {
  const locationStr =
    typeof location === 'string'
      ? location
      : `latitude ${location.lat.toFixed(4)}, longitude ${location.lon.toFixed(4)}`;
  const vibeLabels = vibes
    .map((v) =>
      v === 'food' ? 'restaurants, cafes, bars, or pubs' :
      v === 'activity' ? 'activities like escape rooms, bowling, arcade, mini-golf, or experiences' :
      'dessert spots like gelato shops, cake shops, ice creameries, or dessert bars'
    )
    .join(', ');

  const savedSummary = savedVenues.length > 0
    ? savedVenues.map((v) => `- ${v.name} (${v.type}, ${v.address})`).join('\n')
    : 'No saved venues yet.';

  const savedNames = savedVenues.map((v) => v.name.toLowerCase()).join(', ');

  const travelHint =
    travelTimeMinutes != null && travelTimeMinutes > 0
      ? `The user wants venues within approximately a ${travelTimeMinutes}-minute drive of "${locationStr}". Prioritise venues that are within or close to this driving distance, but still include great matches even if they are slightly further away.`
      : `Find venues in or very close to "${locationStr}".`;

  const tasteGuidance = savedVenues.length > 0
    ? `The user has previously saved these venues they enjoy:\n${savedSummary}\n\nUse these to understand the user's taste — consider the cuisine style, venue type, price range, atmosphere, and suburbs they tend to visit. Find venues that are SIMILAR in style and vibe to what the user already likes, but that they have NOT already saved. Aim for variety: suggest a mix of well-known favourites and hidden gems that match their taste profile.`
    : `The user has no saved venues yet, so suggest broadly popular, well-reviewed venues that are good starting points.`;

  const dietaryGuidance = dietaryPreferences && dietaryPreferences.length > 0
    ? `\n\nIMPORTANT — DIETARY REQUIREMENTS: The user has these dietary preferences/restrictions: ${dietaryPreferences.join(', ')}. You MUST only recommend venues that can genuinely accommodate these dietary needs. For food venues, ensure they have suitable menu options (e.g. vegetarian/vegan dishes, gluten-free options, halal certification, kosher options, dairy-free alternatives, or nut-free menus as applicable). Exclude any venue that cannot cater to these requirements. If recommending a dessert spot, it must also accommodate the dietary needs.`
    : '';

  const content = await callAI(
    [
      {
        role: 'system',
        content:
          `You are a local venue discovery assistant for Australia. Use web search to find 8 real, well-known venues near "${locationStr}". ${travelHint} The user is looking for: ${vibeLabels}. ${tasteGuidance}${dietaryGuidance} ${savedNames ? `Do NOT include any of these venues the user has already saved: ${savedNames}.` : ''} For each venue return: (1) the venue name, (2) the FULL street address including street number, street name, suburb, state and postcode (e.g. '123 George St, Sydney NSW 2000'), (3) the type which must be exactly one of: 'food', 'activity', 'dessert', and (4) a link to the venue's Instagram or website if findable, or null. Return a JSON object: {"venues": [{"name": "...", "address": "...", "type": "food|activity|dessert", "vibe_link": "..." or null}]}. Only include real venues that actually exist. Do not invent or hallucinate venues.`,
      },
      { role: 'user', content: `Find ${vibeLabels} near ${locationStr} that match my taste${dietaryPreferences && dietaryPreferences.length > 0 ? ` and accommodate my dietary needs (${dietaryPreferences.join(', ')})` : ''}` },
    ],
    { temperature: 0.7, responseFormat: 'json_object' }
  );

  let parsed: { venues?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Could not parse venue candidates from response.');
  }

  const arr = Array.isArray(parsed.venues) ? parsed.venues : [];
  const candidates: VenueCandidate[] = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const address = typeof obj.address === 'string' ? obj.address.trim() : '';
    if (!name || !address) continue;
    const type = normalizeType(obj.type) ?? vibes[0];
    const link = typeof obj.vibe_link === 'string' && obj.vibe_link.trim() ? obj.vibe_link.trim() : null;
    candidates.push({ name, address, type, vibe_link: link });
  }

  return candidates;
}
