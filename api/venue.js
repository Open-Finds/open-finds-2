const site = 'https://www.theunsaved.app';
const escape = (text) => String(text).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export default async function handler(req, res) {
  const id = req.query.id;
  if (typeof id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) {
    return res.status(404).send('Recommendation not found');
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(503).send('Venue recommendations are unavailable');
  try {
    const response = await fetch(new URL('/rest/v1/rpc/read_venue_recommendation', url), {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return res.status(503).send('Venue recommendations are unavailable');
    const venue = await response.json();
    if (!venue) return res.status(404).send('Recommendation not found');
    const name = escape(venue.name);
    const address = escape(venue.address);
    const appPath = '/#/venue/' + id;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + name + ' | The Unsaved</title>' +
      '<meta property="og:type" content="website">' +
      '<meta property="og:title" content="' + name + ' | The Unsaved">' +
      '<meta property="og:description" content="' + address + '">' +
      '<meta property="og:image" content="' + site + '/icon-512.png">' +
      '<meta property="og:url" content="' + site + '/v/' + id + '">' +
      '<link rel="canonical" href="' + site + '/v/' + id + '">' +
      '</head><body><main><h1>' + name + '</h1><p>' + address + '</p>' +
      '<a href="' + appPath + '">Open venue in The Unsaved</a></main>' +
      '<script>location.replace(' + JSON.stringify(appPath) + ')</script></body></html>',
    );
  } catch {
    return res.status(503).send('Venue recommendations are unavailable');
  }
}
