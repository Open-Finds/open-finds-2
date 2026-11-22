import { describe, expect, it, vi } from 'vitest';
import {
  addressFromText, areaFromLocationTag, captionHandles, fillAddressEvidence, handleMatchesName, isWrittenAddress, profileBio,
} from './venueEvidence';

describe('area from a location tag', () => {
  it('uses a suburb or city tag', () => {
    expect(areaFromLocationTag({ name: 'Chatswood', address: 'New South Wales, Australia', kind: 'Other Places' }))
      .toBe('Chatswood, New South Wales, Australia');
    expect(areaFromLocationTag({ name: 'Sydney', address: 'New South Wales, Australia', kind: 'City' })).toContain('Sydney');
  });
  it('does not treat a venue tag as an area, or read an empty tag', () => {
    expect(areaFromLocationTag({ name: 'Pour Matcha', address: '1 Help St', kind: 'Restaurant' })).toBeNull();
    expect(areaFromLocationTag(null)).toBeNull();
    expect(areaFromLocationTag({ name: ' ', address: '', kind: 'City' })).toBeNull();
  });
});

describe('handles in a caption', () => {
  it('finds venue handles and skips the creator', () => {
    const texts = ['Banh mi at @duchuongsandwiches and birria at @elcorabirria. Thanks @creator.name! me@example.com'];
    expect(captionHandles(texts, ['creator.name'])).toEqual(['duchuongsandwiches', 'elcorabirria']);
  });
  it('matches a handle to a venue name', () => {
    expect(handleMatchesName('duchuongsandwiches', 'Du Chuong Sandwiches')).toBe(true);
    expect(handleMatchesName('tranpizza', 'Trần Pizza')).toBe(true);
    expect(handleMatchesName('darumabeerhouse_strathfield', 'Daruma Dumplings Beer House')).toBe(true);
    expect(handleMatchesName('elcorabirria', 'Du Chuong Sandwiches')).toBe(false);
    expect(handleMatchesName('abc', 'abc')).toBe(false);
  });
});

describe('an address written in plain text', () => {
  it.each([
    ['Made in-house. Baked fresh daily | 68 Erskine Street, Sydney NSW | Mon-Sat', '68 Erskine Street, Sydney NSW'],
    ['Fresh handmade dumplings in the shop1-2/ 12 churchill ave, strathfield, Sydney', 'shop1-2/ 12 churchill ave, strathfield, Sydney'],
    ['Address: 120 Pham Van Dong street, Ward 3, Go Vap district, Ho Chi Minh city, Vietnam. Follow us', '120 Pham Van Dong street, Ward 3, Go Vap district, Ho Chi Minh city, Vietnam'],
    ['Find us at 215B Nguyen Trai street, Cau Ong Lanh', '215B Nguyen Trai street, Cau Ong Lanh'],
  ])('reads %j', (text, expected) => {
    expect(addressFromText(text)).toBe(expected);
  });
  it('finds nothing when there is no street address', () => {
    expect(addressFromText('Best dumplings in town 🥟 #sydneyfood https://example.com/1 Main St')).toBeNull();
    expect(addressFromText(null)).toBeNull();
  });
  it('accepts a labelled address that has no street word, but not a plain line or a link', () => {
    expect(isWrittenAddress('215B Nguyen Trai, Cau Ong Lanh, Ho Chi Minh City, Vietnam')).toBe(true);
    expect(isWrittenAddress('Chatswood, NSW')).toBe(false);
    expect(isWrittenAddress('3 courses https://example.com, 2 for 1')).toBe(false);
  });
  it('reads the bio out of an Instagram profile description', () => {
    expect(profileBio('5,077 Followers, 0 Following, 36 Posts - SALTED. (@salted.cafe) on Instagram: "Baked daily 68 Erskine Street, Sydney"'))
      .toBe('Baked daily 68 Erskine Street, Sydney');
    expect(profileBio(null)).toBe('');
  });
});

describe('filling in addresses with free evidence', () => {
  const base = { texts: ['try @duchuongsandwiches'], creatorHandle: 'someone', area: 'Chatswood, New South Wales, Australia', hasStreet: (a: string) => /\d/.test(a) };

  it('prefers the address in the venue profile bio, and says it came from the source', async () => {
    const items = [{ name: 'Du Chuong Sandwiches', address: '' }];
    const fetchBio = vi.fn(async () => 'Banh mi, Shop 3/45 Bunnerong Rd, Eastgardens NSW | Open daily');
    expect(await fillAddressEvidence(items, { ...base, fetchBio })).toEqual(['Shop 3/45 Bunnerong Rd, Eastgardens NSW']);
    expect(items[0].address).toBe('Shop 3/45 Bunnerong Rd, Eastgardens NSW');
    expect(fetchBio).toHaveBeenCalledWith('duchuongsandwiches');
  });

  it('falls back to the tagged suburb when the bio has no address, and never overwrites a street address', async () => {
    const items = [{ name: 'Du Chuong Sandwiches', address: '' }, { name: 'Other Cafe', address: '1 Test St, Sydney' }, { name: 'Third', address: 'Campsie, NSW' }];
    const fetchBio = vi.fn(async () => 'Just a bio');
    expect(await fillAddressEvidence(items, { ...base, fetchBio })).toEqual([]);
    expect(items.map((item) => item.address)).toEqual(['Chatswood, New South Wales, Australia', '1 Test St, Sydney', 'Campsie, NSW']);
    expect(fetchBio).toHaveBeenCalledTimes(1);
  });

  it('limits profile lookups and survives a failed lookup', async () => {
    const items = ['aaaaaa one', 'bbbbbb two', 'cccccc three', 'dddddd four'].map((name) => ({ name, address: '' }));
    const fetchBio = vi.fn(async () => { throw new Error('blocked'); });
    await fillAddressEvidence(items, {
      ...base, texts: ['@aaaaaaone @bbbbbbtwo @ccccccthree @ddddddfour'], fetchBio, maxLookups: 2,
    });
    expect(fetchBio).toHaveBeenCalledTimes(2);
    expect(items.every((item) => item.address === base.area)).toBe(true);
  });
});
