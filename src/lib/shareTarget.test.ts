import { describe, it, expect } from 'vitest';
import { linkFromShare } from './shareTarget';

/** What Instagram, TikTok and Maps actually send when you tap Share → The Unsaved. */
describe('linkFromShare', () => {
  const share = (q: Record<string, string>) => new URLSearchParams(q);

  it('takes the url field when there is one', () => {
    expect(linkFromShare(share({ url: 'https://www.instagram.com/reel/C9abc/' }))).toBe('https://www.instagram.com/reel/C9abc/');
  });

  it('finds the link inside shared text, as Instagram and TikTok send it', () => {
    expect(linkFromShare(share({ text: 'Check out this reel! https://www.instagram.com/reel/C9abc/?igsh=MWx4 ' })))
      .toBe('https://www.instagram.com/reel/C9abc/?igsh=MWx4');
    expect(linkFromShare(share({ title: 'TikTok', text: 'Korean fusion burgers 🍔 https://vt.tiktok.com/ZSbaLC6gH/' })))
      .toBe('https://vt.tiktok.com/ZSbaLC6gH/');
  });

  it('drops punctuation stuck to the end of the link', () => {
    expect(linkFromShare(share({ text: 'Go here (https://maps.app.goo.gl/AbC123).' }))).toBe('https://maps.app.goo.gl/AbC123');
  });

  it('returns nothing when no link was shared', () => {
    expect(linkFromShare(share({ text: 'just some words' }))).toBeNull();
    expect(linkFromShare(share({}))).toBeNull();
  });
});
