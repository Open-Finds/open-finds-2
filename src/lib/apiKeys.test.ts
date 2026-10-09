import { describe, it, expect } from 'vitest';
import { areaOf, hasStreetNumber, isAustralianAddress, isGoogleMapsLink, tidyAddress } from './apiKeys';

/** Every way people share a place from Google Maps has to reach resolve-place. */
describe('isGoogleMapsLink', () => {
  it('recognises the links the Maps app and website share', () => {
    for (const url of [
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/AbCdEf123',
      'https://www.google.com/maps/place/Mr+Wong/@-33.86,151.20,17z',
      'https://www.google.com.au/maps/place/Mr.+Wong/@-33.8645,151.2073,17z',
      'https://www.google.co.uk/maps/search/?api=1&query=Dishoom',
      'https://maps.google.com/?q=Bourke+Street+Bakery',
      'https://maps.google.com.au/maps?cid=123',
      'https://g.co/kgs/AbC123',
      'maps.app.goo.gl/AbCdEf123',
      // Google's newer Share button, and the place result it opens.
      'https://share.google/HnI7t4PTlgm1i9vzx',
      'https://www.google.com/search?kgmid=/g/11t8kpblsr&q=ANGRY+BULL+BURGER',
    ]) {
      expect(isGoogleMapsLink(url), url).toBe(true);
    }
  });

  it('leaves other links alone', () => {
    for (const url of [
      'https://www.instagram.com/reel/abc/',
      'https://www.tiktok.com/@x/video/1',
      'https://www.google.com/search?q=pizza',
      'https://goo.gl/abc',
      'https://notgoogle.com/maps/x',
      'https://google.com.evil.example/maps/x',
      'not a link',
    ]) {
      expect(isGoogleMapsLink(url), url).toBe(false);
    }
  });
});

/** Area-only addresses get looked up for a street; real ones are left alone. */
describe('hasStreetNumber', () => {
  it('spots a street address', () => {
    for (const a of ['28 Princes Hwy, Kogarah NSW 2217', '236/240 Georges River Rd, Croydon Park NSW 2133, Australia', 'Shop 14/2 Circular Quay E, Sydney NSW 2000']) {
      expect(hasStreetNumber(a), a).toBe(true);
    }
  });
  it('treats a suburb, state and postcode as an area only', () => {
    for (const a of [
      'at the Barista Bar Metro, Croydon Park NSW 2133', 'Croydon Park', 'Surry Hills NSW 2010, Australia', '',
      // Overseas postcodes aren't street numbers either.
      'Nakameguro, Meguro City, Tokyo 153-0061', 'Shibuya, Tokyo, 〒150-0002, Japan',
    ]) {
      expect(hasStreetNumber(a), a).toBe(false);
    }
  });
});

/** Venues abroad: what counts as Australian, the area of an address, and Japanese order. */
describe('overseas addresses', () => {
  it('knows Australian addresses', () => {
    expect(isAustralianAddress('28 Princes Hwy, Kogarah NSW 2217')).toBe(true);
    expect(isAustralianAddress('1-15-19 Shibuya, Shibuya City, Tokyo 150-0002, Japan')).toBe(false);
  });
  it('keeps only the area of an address', () => {
    expect(areaOf('1-1-1, Asakusa, Taito City, Tokyo 111-0032')).toBe('Asakusa, Taito City, Tokyo 111-0032');
    expect(areaOf('1-1-1 Kamimeguro, Meguro City, Tokyo, Japan')).toBe('Meguro City, Tokyo, Japan');
  });
  it('turns Google\'s big-to-small Japanese addresses round', () => {
    expect(tidyAddress('Japan, 〒150-0013 Tokyo, Shibuya, Ebisu, 1-chōme−6−６ Saito Bldg., １階'))
      .toBe('Level 1, 1-chōme-6-6 Saito Bldg., Ebisu, Shibuya, Tokyo 150-0013, Japan');
    expect(tidyAddress('1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan')).toBe('1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan');
    expect(tidyAddress('3-chōme-16 1階, Kanda Nishikichō, Chiyoda City, Tokyo 101-0054, Japan'))
      .toBe('3-chōme-16 Level 1, Kanda Nishikichō, Chiyoda City, Tokyo 101-0054, Japan');
    expect(tidyAddress('28 Princes Hwy, Kogarah NSW 2217')).toBe('28 Princes Hwy, Kogarah NSW 2217');
  });
});
