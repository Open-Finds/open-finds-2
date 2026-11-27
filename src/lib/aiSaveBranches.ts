/**
 * Backup step for one cryptic kind of post: one business that lists its branches only as suburbs
 * ("Locations: Hawthorn | Moorabbin"). It runs only when every venue AI Save read has no address, so a post that
 * already gives something to save is never touched. It searches Google for each branch and keeps only a place whose
 * name carries the business's name and whose address is in that suburb. Anything else stays unsaveable: no guessing.
 */
import { searchGooglePlaces } from './apiKeys';
import { captionPlainText, type VenueExtractionProgress } from './openai';
import type { VenueRow } from './aiSave';

/** Hosts that say nothing about who the business is. */
const NOT_A_BRAND = new Set(['instagram', 'tiktok', 'facebook', 'youtube', 'google', 'linktr', 'bit', 'tinyurl', 'beacons', 'opentable', 'sevenrooms', 'nowbookit', 'resy']);

const key = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const words = (value: string) => ` ${value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** The suburbs written under a "Locations:" heading, in the post's order. */
export function listedSuburbs(caption: string): string[] {
  const text = caption.normalize('NFKC');
  const heading = /\blocations\s*:/iu.exec(text);
  if (!heading) return [];
  let list = text.slice(heading.index + heading[0].length);
  // The list ends at a hashtag, a blank line, or any emoji other than the pin.
  const end = list.search(/#|\n\s*\n|(?!📍)\p{Extended_Pictographic}/u);
  if (end >= 0) list = list.slice(0, end);
  const suburbs: string[] = [];
  for (const piece of list.split(/[|•\n]|📍/u).map(part => part.trim()).filter(Boolean)) {
    if (!/^\p{Lu}[\p{L}'. -]{1,29}$/u.test(piece) || piece.split(/\s+/).length > 3) break;
    if (!suburbs.includes(piece)) suburbs.push(piece);
  }
  return suburbs;
}

/** Who the post is from: the website it links to, and the account that posted it. */
function brandKeys(caption: string, handle: string | null | undefined): string[] {
  const sites = [...caption.matchAll(/https?:\/\/(?:www\.)?([a-z0-9-]+)\./giu)].map(match => match[1])
    .filter(site => !NOT_A_BRAND.has(site.toLowerCase()));
  return [...new Set([...sites, handle ?? ''].map(key).filter(brand => brand.length >= 5))];
}

/** The same rows when this step does not apply or finds nothing; otherwise one row per listed branch, up to `limit`. */
export async function findBranches(rows: VenueRow[], identification: VenueExtractionProgress | undefined, link: string,
  attemptId: string | undefined, limit: number): Promise<VenueRow[]> {
  if (!rows.length || rows.some(row => row.venue.address.trim())) return rows;
  const meta = identification?.metadata;
  if (!meta || (meta.platform !== 'instagram' && meta.platform !== 'tiktok')) return rows;
  const caption = captionPlainText(meta);
  const suburbs = listedSuburbs(caption).slice(0, limit);
  const brands = brandKeys(caption, meta.handle);
  if (suburbs.length < 2 || !brands.length) return rows;
  // The business's written name ("Third Wave BBQ on Instagram") searches better than a joined-up handle.
  const title = meta.ogTitle?.split(/\s+on (?:Instagram|TikTok)|\s*[|(•]/u)[0].trim() ?? '';
  const name = title && brands.some(brand => key(title).includes(brand)) ? title : brands[0];
  const { type, tags } = rows[0].venue;

  const branches = await Promise.all(suburbs.map(async (suburb): Promise<VenueRow> => {
    const unfound: VenueRow = { venue: { name: `${name} ${suburb}`, address: '', type, link, lat: null, lon: null, tags }, verified: false };
    try {
      const matches = (await searchGooglePlaces(`${name} ${suburb}`, attemptId)).filter(place =>
        brands.some(brand => key(place.name).includes(brand)) && words(place.address).includes(words(suburb)));
      if (matches.length !== 1) return unfound;
      const [place] = matches;
      return { venue: { name: place.name, address: place.address, type: place.type ?? type, link, lat: place.lat, lon: place.lon,
        venueToken: place.venueToken, tags }, verified: true };
    } catch {
      return unfound;
    }
  }));
  return branches.some(row => row.verified) ? branches : rows;
}
