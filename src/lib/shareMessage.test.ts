import { describe, expect, it } from 'vitest';
import { ADDRESS_TOKEN, insertAtCursor, nextPreset, PRESET_MESSAGES, resolveMessage, VENUE_TOKEN } from './shareMessage';
import { cleanVenueName } from './publicRecommendation.js';

describe('cleanVenueName', () => {
  it('drops separators left on the ends of a name', () => {
    expect(cleanVenueName('Yee3 • World Square •')).toBe('Yee3 • World Square');
    expect(cleanVenueName(' | Gorilla Smokers - ')).toBe('Gorilla Smokers');
    expect(cleanVenueName('Kang-Chon BBQ')).toBe('Kang-Chon BBQ');
    expect(cleanVenueName(null)).toBe('');
  });
});

describe('resolveMessage', () => {
  const venue = { name: 'Yee3 • World Square •', address: 'Shop 6/385 Pitt St, Sydney NSW 2000' };
  it('fills the chips with the verified name and address', () => {
    expect(resolveMessage(`Down? ${VENUE_TOKEN} ${ADDRESS_TOKEN}`, venue)).toBe('Down? Yee3 • World Square Shop 6/385 Pitt St, Sydney NSW 2000');
  });
  it('drops a chip when there is nothing to put in it', () => {
    expect(resolveMessage(`Try ${VENUE_TOKEN}!`)).toBe('Try !');
    expect(resolveMessage(`Can we try this? ${ADDRESS_TOKEN}`, { name: 'x', address: '  ' })).toBe('Can we try this?');
  });
  it('sends a plain message untouched and an empty one as empty', () => {
    expect(resolveMessage('Lets go', venue)).toBe('Lets go');
    expect(resolveMessage('   ', venue)).toBe('');
  });
});

describe('insertAtCursor', () => {
  it('adds a chip at the cursor with spaces around it', () => {
    expect(insertAtCursor('Down?', VENUE_TOKEN, 5, 5)).toEqual({ value: 'Down? [venue name]', cursor: 18 });
    expect(insertAtCursor('Down? lets go', ADDRESS_TOKEN, 5, 5).value).toBe('Down? [address] lets go');
  });
  it('replaces a selection and works on an empty box', () => {
    expect(insertAtCursor('', VENUE_TOKEN, 0, 0).value).toBe('[venue name]');
    expect(insertAtCursor('abc def', VENUE_TOKEN, 0, 3).value).toBe('[venue name] def');
  });
});

describe('nextPreset', () => {
  it('cycles through every preset and wraps', () => {
    let current: string = PRESET_MESSAGES[0];
    const seen = [current];
    for (let i = 0; i < PRESET_MESSAGES.length; i++) { current = nextPreset(current); seen.push(current); }
    expect(new Set(seen).size).toBe(PRESET_MESSAGES.length);
    expect(seen[seen.length - 1]).toBe(PRESET_MESSAGES[0]);
  });
  it('starts from the first preset when the text is something else', () => {
    expect(nextPreset('my own words')).toBe(PRESET_MESSAGES[0]);
  });
});
