import { describe, it, expect } from 'vitest';
import { isGoogleMapsLink } from './apiKeys';

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
