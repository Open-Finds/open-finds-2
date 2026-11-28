import { loadRecommendation, isUnverified } from './_recommendation.js';
import { cleanVenueName, publicVenueLink } from '../src/lib/publicRecommendation.js';

const escape = (text) => String(text).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export default async function handler(req, res) {
  const id = req.query.id;
  const found = await loadRecommendation(id);
  if (found.error) return res.status(found.error.status).send(found.error.message);
  const { venue, staging, origin } = found;
  try {
    const canonical = origin + '/venue/' + id;
    const name = escape(cleanVenueName(venue.name));
    const address = escape(venue.address);
    // What a chat app prints on the card: "Urth Cafe | 4/165 Wattle St, Mount Lewis NSW 2190". Chat apps show the title, not the description.
    const headline = address.trim() ? name + ' | ' + address : name;
    const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue.name + ', ' + venue.address);
    const reel = publicVenueLink(venue.link);
    const unverified = isUnverified(req);
    // A generated card (category background, name, address) unless a real photograph is on file for this venue.
    const card = origin + '/api/venue-image?id=' + id + (unverified ? '&u=1' : '');
    const photo = staging && id === '497dfa0b-29bf-446d-a272-f8a9211d53bd'
      ? 'https://tb-static.uber.com/prod/image-proc/processed_images/0e733286e4a4d55d86d5eb6acaacb847/1651207c9cb2a7942b37b3f3e4a0b899.jpeg'
      : card;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + headline + '</title>' +
      '<meta property="og:type" content="website">' +
      '<meta property="og:site_name" content="The Unsaved">' +
      '<meta property="og:title" content="' + headline + '">' +
      '<meta property="og:description" content="' + address + (unverified ? ' (address not confirmed)' : '') + '">' +
      '<meta property="og:image" content="' + escape(photo) + '">' +
      (photo === card ? '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '') +
      '<meta property="og:image:alt" content="' + name + '">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta property="og:url" content="' + canonical + '">' +
      '<link rel="canonical" href="' + canonical + '">' +
      '<style>body{background:#f8fafc;color:#15202b;font:1rem system-ui,sans-serif;margin:0}main{max-width:36rem;margin:3rem auto;padding:1.5rem}img{display:block;max-width:100%;max-height:22rem;border-radius:1rem}a{color:#153a7b}nav{display:flex;gap:1rem;flex-wrap:wrap}.note{color:#92400e}</style>' +
      '</head><body><main><p>The Unsaved</p><h1>' + name + '</h1><p>' + address + '</p>' +
      (unverified ? '<p class="note">Address not confirmed on Google Maps. Check it before you go.</p>' : '') +
      '<img src="' + escape(photo) + '" alt="' + name + '"><nav>' +
      '<a href="' + escape(maps) + '">Open in Google Maps</a>' +
      (reel ? '<a href="' + escape(reel) + '">Watch original Reel</a>' : '') +
      '<a href="/#/venue/' + id + '">Save or plan in The Unsaved</a></nav></main></body></html>',
    );
  } catch {
    return res.status(503).send('Venue recommendations are unavailable');
  }
}
