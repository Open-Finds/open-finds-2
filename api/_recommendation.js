// Shared by the public venue page and its share-card image. Files starting with "_" are not deployed as routes.
const productionOrigin = 'https://www.theunsaved.app';
const stagingOrigin = 'https://open-finds-2-bnuk-git-feature-ai-save-quick-share-date-planner.vercel.app';
const stagingSupabase = 'https://crpkzysdtnoomzimibhe.supabase.co';
const stagingBranch = 'feature/ai-save-quick-share';

export const validId = id => typeof id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id);

/**
 * Reads a published recommendation. Returns { venue, origin, staging } or { error: { status, message } }.
 * The messages are the ones the page has always used.
 */
export async function loadRecommendation(id) {
  if (!validId(id)) return { error: { status: 404, message: 'Recommendation not found' } };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  const staging = url === stagingSupabase;
  if (!url || !key || (process.env.VERCEL_GIT_COMMIT_REF === stagingBranch && !staging)) {
    return { error: { status: 503, message: 'Venue recommendations are unavailable' } };
  }
  try {
    const response = await fetch(new URL('/rest/v1/rpc/read_venue_recommendation', url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { error: { status: 503, message: 'Venue recommendations are unavailable' } };
    const venue = await response.json();
    if (!venue) return { error: { status: 404, message: 'Recommendation not found' } };
    return { venue, staging, origin: staging ? stagingOrigin : productionOrigin };
  } catch {
    return { error: { status: 503, message: 'Venue recommendations are unavailable' } };
  }
}

/** The link flags an address Google has not confirmed with ?u=1. It only changes a label. */
export const isUnverified = req => req.query?.u === '1';
