import { describe, it, expect } from 'vitest';
import { linkHref } from './links';

describe('linkHref', () => {
  it('keeps full web links as they are', () => {
    expect(linkHref('https://www.instagram.com/reel/abc/')).toBe('https://www.instagram.com/reel/abc/');
    expect(linkHref('http://example.com')).toBe('http://example.com');
  });

  it('adds https to links saved without a scheme', () => {
    expect(linkHref('instagram.com/barlune')).toBe('https://instagram.com/barlune');
    expect(linkHref('  www.tiktok.com/@x/video/1 ')).toBe('https://www.tiktok.com/@x/video/1');
    expect(linkHref('//example.com/a')).toBe('https://example.com/a');
  });

  it('drops anything that is not a web link', () => {
    expect(linkHref('javascript:alert(1)')).toBeNull();
    expect(linkHref('data:text/html,hi')).toBeNull();
  });

  it('returns null for empty values', () => {
    expect(linkHref(null)).toBeNull();
    expect(linkHref(undefined)).toBeNull();
    expect(linkHref('   ')).toBeNull();
  });
});
