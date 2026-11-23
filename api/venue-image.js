import { readFileSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadRecommendation, isUnverified } from './_recommendation.js';
import { cleanVenueName } from '../src/lib/publicRecommendation.js';

const WIDTH = 1200;
const HEIGHT = 630;

// The app's own typeface (SIL Open Font License, see api/_fonts), read once per server instance.
const font = file => readFileSync(new URL('./_fonts/' + file, import.meta.url));
let fonts;
const loadFonts = () => (fonts ??= [
  { name: 'Bricolage Grotesque', data: font('bricolage-grotesque-latin-600-normal.woff'), weight: 600, style: 'normal' },
  { name: 'Bricolage Grotesque', data: font('bricolage-grotesque-latin-800-normal.woff'), weight: 800, style: 'normal' },
]);

/** The card as a PNG. */
export async function renderCard(venue) {
  const svg = await satori(card(venue), { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}

/** Category backgrounds, in the app's orange, violet and cyan. One per saved venue type. */
const CATEGORY = {
  food: { label: 'FOOD', from: '#F2672A', to: '#F9A03C' },
  dessert: { label: 'DESSERT', from: '#E8498F', to: '#F2672A' },
  bar: { label: 'DRINKS', from: '#6B3FD9', to: '#E8498F' },
  activity: { label: 'ACTIVITY', from: '#1AA7C9', to: '#6B3FD9' },
};

const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const clip = (text, max) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);

export function card({ name, address, type, unverified }) {
  const look = CATEGORY[type] ?? CATEGORY.food;
  const title = clip(name, 64);
  const size = title.length <= 20 ? 76 : title.length <= 36 ? 62 : 50;
  return h('div', { width: WIDTH, height: HEIGHT, flexDirection: 'column', background: '#FFFFFF' }, [
    // The picture area: a category background with large soft shapes and the category in big letters.
    h('div', {
      height: 350, width: '100%', position: 'relative', overflow: 'hidden',
      backgroundImage: `linear-gradient(120deg, ${look.from}, ${look.to})`,
    }, [
      h('div', { position: 'absolute', left: -120, top: -160, width: 520, height: 520, borderRadius: 260, background: 'rgba(255,255,255,0.14)' }, ''),
      h('div', { position: 'absolute', right: -80, bottom: -200, width: 640, height: 640, borderRadius: 320, background: 'rgba(255,255,255,0.12)' }, ''),
      h('div', { position: 'absolute', right: 150, top: 60, width: 150, height: 150, borderRadius: 75, background: 'rgba(255,255,255,0.18)' }, ''),
      h('div', {
        position: 'absolute', left: 64, bottom: 36, fontSize: 120, fontWeight: 800, letterSpacing: 6,
        color: 'rgba(255,255,255,0.88)',
      }, look.label),
    ]),
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '0 64px' }, [
      h('div', { fontSize: size, fontWeight: 800, color: '#14161B', lineHeight: 1.05, maxHeight: size * 2.2, overflow: 'hidden' }, title),
      h('div', { marginTop: 10, fontSize: 30, color: '#6B7280', lineHeight: 1.2 }, clip(address, 80)),
      h('div', { marginTop: 14, justifyContent: 'space-between', alignItems: 'center', fontSize: 24, color: '#9CA3AF' }, [
        h('div', {}, 'The Unsaved'),
        unverified ? h('div', { color: '#B45309' }, 'Address not confirmed') : h('div', {}, ''),
      ]),
    ]),
  ]);
}

export default async function handler(req, res) {
  const found = await loadRecommendation(req.query.id);
  if (found.error) return res.status(found.error.status).send(found.error.message);
  const { venue } = found;
  try {
    const body = await renderCard({
      name: cleanVenueName(venue.name),
      address: String(venue.address ?? '').trim(),
      type: venue.type,
      unverified: isUnverified(req),
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(body);
  } catch {
    return res.status(503).send('Venue image is unavailable');
  }
}
