const productionOrigin = 'https://www.theunsaved.app';
const stagingOrigin = 'https://open-finds-2-bnuk-git-feature-ai-save-quick-share-date-planner.vercel.app';
const stagingSupabase = 'https://crpkzysdtnoomzimibhe.supabase.co';
const stagingBranch = 'feature/ai-save-quick-share';
const escape = (text) => String(text).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function httpsLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const id = req.query.id;
  if (typeof id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) {
    return res.status(404).send('Recommendation not found');
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  const staging = url === stagingSupabase;
  if (!url || !key || (process.env.VERCEL_GIT_COMMIT_REF === stagingBranch && !staging)) {
    return res.status(503).send('Venue recommendations are unavailable');
  }
  try {
    const response = await fetch(new URL('/rest/v1/rpc/read_venue_recommendation', url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return res.status(503).send('Venue recommendations are unavailable');
    const venue = await response.json();
    if (!venue) return res.status(404).send('Recommendation not found');

    const origin = staging ? stagingOrigin : productionOrigin;
    const canonical = origin + '/venue/' + id;
    const name = escape(venue.name);
    const address = escape(venue.address);
    const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue.name + ', ' + venue.address);
    const reel = httpsLink(venue.link);
    const photo = staging && id === '497dfa0b-29bf-446d-a272-f8a9211d53bd'
      ? 'https://assets.foodhub.com/static/1b02396053de04a56d39e106a58e5560/img/1635712784php0CwJ6H.jpg'
      : origin + '/icon-512.png';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + name + ' | The Unsaved</title>' +
      '<meta property="og:type" content="website">' +
      '<meta property="og:title" content="' + name + ' | The Unsaved">' +
      '<meta property="og:description" content="' + address + '">' +
      '<meta property="og:image" content="' + escape(photo) + '">' +
      '<meta property="og:url" content="' + canonical + '">' +
      '<link rel="canonical" href="' + canonical + '">' +
      '<style>body{background:#f8fafc;color:#15202b;font:1rem system-ui,sans-serif;margin:0}main{max-width:36rem;margin:3rem auto;padding:1.5rem}img{display:block;max-width:100%;max-height:22rem;border-radius:1rem}a{color:#153a7b}nav{display:flex;gap:1rem;flex-wrap:wrap}</style>' +
      '</head><body><main><p>The Unsaved</p><h1>' + name + '</h1><p>' + address + '</p>' +
      '<img src="' + escape(photo) + '" alt="' + name + '"><nav>' +
      '<a href="' + escape(maps) + '">Open in Google Maps</a>' +
      (reel ? '<a href="' + escape(reel) + '">Watch original Reel</a>' : '') +
      '<a href="/#/venue/' + id + '">Save or plan in The Unsaved</a></nav></main></body></html>',
    );
  } catch {
    return res.status(503).send('Venue recommendations are unavailable');
  }
}
