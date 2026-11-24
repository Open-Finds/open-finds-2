/**
 * Free evidence for where a venue is, read with plain code before any paid AI
 * or Google call: the area a creator tagged, the venue's own profile bio, and
 * an address written in any country. Nothing here talks to a paid service.
 */

export type TagLocation = { name: string; address: string; kind: string };

const AREA_KINDS = /^(city|other places|neighbou?rhood|suburb|town|district|region|state|province|country)$/i;

/**
 * A suburb or city from a location tag, e.g. "Chatswood, New South Wales, Australia".
 * Only when the tag is an area; a tag naming a venue is not an area.
 */
export function areaFromLocationTag(location: TagLocation | null | undefined): string | null {
  if (!location?.name?.trim()) return null;
  if (location.kind && !AREA_KINDS.test(location.kind.trim())) return null;
  const area = [location.name, location.address].map((part) => part?.trim()).filter(Boolean).join(', ');
  return area ? area.slice(0, 200) : null;
}

/** The @handles in a caption (letters, digits, dots, underscores), without the creator's own handle. */
export function captionHandles(texts: (string | null | undefined)[], skip: (string | null | undefined)[] = []): string[] {
  const skipped = new Set(skip.filter((value): value is string => !!value).map((value) => value.toLowerCase().replace(/^@/, '')));
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/(?:^|[^\p{L}\p{N}._])@([A-Za-z0-9._]{3,30})/gu)) {
      const handle = match[1].replace(/[._]+$/, '').toLowerCase();
      if (handle.length >= 3 && !skipped.has(handle)) found.add(handle);
    }
  }
  return [...found];
}

const squash = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "@duchuongsandwiches" is the venue "Du Chuong Sandwiches"; "@darumabeerhouse_strathfield" is "Daruma Dumplings Beer House". */
export function handleMatchesName(handle: string, name: string): boolean {
  const h = squash(handle);
  const n = squash(name);
  if (h.length < 5 || n.length < 5) return false;
  if (h === n || h.includes(n) || n.includes(h)) return true;
  let shared = 0;
  while (shared < h.length && shared < n.length && h[shared] === n[shared]) shared++;
  return shared >= 6;
}

const STREET_WORDS = 'street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|terrace|tce|way|parade|pde|crescent|cres|highway|hwy|boulevard|blvd|bvd|square|sq|court|ct|close|cl|plaza|walk|arcade|mall';
const STREET_ADDRESS = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])((?:(?:shop|unit|suite|level|lvl)\\s*)?\\d+[a-z]?(?:\\s*[-/–]\\s*\\d+[a-z]?)*\\s+[\\p{L}.'’ -]{2,40}?\\s(?:${STREET_WORDS})\\b\\.?)`,
  'iu',
);

/**
 * A street address written in plain text, in any country: "shop1-2/ 12 churchill ave, strathfield, Sydney",
 * "68 Erskine Street, Sydney NSW". Returns the street and a little of what follows, or null.
 */
export function addressFromText(text: string | null | undefined): string | null {
  const clean = (text ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ').replace(/\s+/g, ' ');
  const found = clean.match(STREET_ADDRESS);
  if (!found || found.index === undefined) return null;
  const start = found.index + found[0].length - found[1].length;
  const tail = clean.slice(start + found[1].length, start + found[1].length + 60);
  // Stop at the first thing that is clearly not part of an address.
  const rest = tail.split(/[|•·"“”()\u{1F300}-\u{1FAFF}]|\.\s|\s{2,}/u)[0].replace(/\b(open|tel|phone|call|book|menu|since|est)\b.*$/i, '');
  return (found[1] + rest).replace(/\s+/g, ' ').replace(/[,\s-]+$/, '').trim() || null;
}

/**
 * For a line the creator labelled as an address ("Address: ..."): a number, then at least two comma-separated
 * parts. Streets in some countries have no street word ("215B Nguyen Trai, Cau Ong Lanh"), so no street word is needed.
 */
export function isWrittenAddress(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  return value.length >= 8 && value.length <= 160 && /\d/.test(value) && value.split(',').filter((part) => part.trim()).length >= 2 &&
    !/[#@<>]|https?:/i.test(value);
}

/** The bio part of an Instagram profile description: "5,077 Followers ... on Instagram: \"bio\"" is "bio". */
export function profileBio(description: string | null | undefined): string {
  if (!description) return '';
  const marked = description.match(/on Instagram:\s*["“]?([\s\S]*?)["”]?\s*$/i);
  return (marked ? marked[1] : description).replace(/&#064;/g, '@').replace(/&amp;/g, '&');
}

export type EvidenceItem = { name: string; address: string };

/**
 * Gives venues that have no street address the best free evidence, in this order:
 * 1. the address in the venue's own profile bio (found through an @handle in the caption that matches its name);
 * 2. the suburb or city the creator tagged.
 * Items are changed in place. Returns the addresses that came from a profile bio, so the caller can treat them as source-backed.
 */
export async function fillAddressEvidence(items: EvidenceItem[], context: {
  texts: (string | null | undefined)[];
  creatorHandle?: string | null;
  area: string | null;
  hasStreet: (address: string) => boolean;
  fetchBio: (handle: string) => Promise<string | null>;
  maxLookups?: number;
}): Promise<string[]> {
  const fromBios: string[] = [];
  const handles = captionHandles(context.texts, [context.creatorHandle]);
  let lookups = 0;
  for (const item of items) {
    if (item.address && context.hasStreet(item.address)) continue;
    const handle = handles.find((candidate) => handleMatchesName(candidate, item.name));
    if (handle && lookups < (context.maxLookups ?? 3)) {
      lookups++;
      const address = addressFromText(profileBio(await context.fetchBio(handle).catch(() => null)));
      if (address) {
        item.address = address;
        fromBios.push(address);
        continue;
      }
    }
    // No street: a suburb is enough for Google to find the venue by name.
    if (context.area && !item.address) item.address = context.area;
  }
  return fromBios;
}
