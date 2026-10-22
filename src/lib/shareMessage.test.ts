import { describe, expect, it } from 'vitest';
import { composeShareMessage, DEFAULT_SHARE_MESSAGE } from './shareMessage';

describe('composeShareMessage', () => {
  it('uses the exact greeting, spacing, Maps search and original reel link', () => {
    expect(DEFAULT_SHARE_MESSAGE).toBe("Let's check this out!🤩");
    expect(composeShareMessage({
      message: DEFAULT_SHARE_MESSAGE,
      name: 'Good Cafe',
      address: '10 Main St, Melbourne',
      link: 'https://www.instagram.com/reel/ABC/?igsh=original',
    })).toBe("Let's check this out!🤩\n\nGood Cafe\n10 Main St, Melbourne\nOpen in Maps: https://www.google.com/maps/search/?api=1&query=10%20Main%20St%2C%20Melbourne\n\nhttps://www.instagram.com/reel/ABC/?igsh=original");
  });

  it('uses the edited values and preserves the original link exactly once', () => {
    const link = 'https://www.tiktok.com/@creator/video/123?x=1&y=2';
    const text = composeShareMessage({ message: 'Come along!', name: 'New name', address: '5 A & B Rd', link });
    expect(text).toBe(`Come along!\n\nNew name\n5 A & B Rd\nOpen in Maps: https://www.google.com/maps/search/?api=1&query=5%20A%20%26%20B%20Rd\n\n${link}`);
    expect(text.split(link)).toHaveLength(2);
  });
});
