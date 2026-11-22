import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageLog } from './stagelog';

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const lastLine = () => JSON.parse(String(log.mock.calls.at(-1)?.[0]));

describe('stage log', () => {
  it('writes one JSON line with stage, time, outcome and counts', () => {
    stageLog('resolve-place', 'verify', Date.now() - 250, 'no_match', { count: 3, weak: true, mode: 'name_address' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(lastLine()).toMatchObject({ log: 'stage', fn: 'resolve-place', stage: 'verify', outcome: 'no_match', count: 3, weak: true, mode: 'name_address' });
    expect(lastLine().ms).toBeGreaterThanOrEqual(250);
  });

  it('never writes caption text, names, addresses or links', () => {
    stageLog('extract-venue-meta', 'extract', Date.now(), 'ok', {
      caption: '📍 Pour, Shop 3, 1 Help St, Chatswood', handle: 'some.creator@example.com', link: 'https://www.instagram.com/reel/abc',
    });
    const text = String(log.mock.calls[0][0]);
    expect(text).not.toMatch(/Pour|Chatswood|Help St|example\.com|instagram\.com/);
    expect(lastLine()).toMatchObject({ caption: 'redacted', handle: 'redacted', link: 'redacted' });
  });

  it('only lets the model field hold a model id, not a link', () => {
    stageLog('ai-proxy', 'ai', Date.now(), 'ok', { model: 'https://www.instagram.com/reel/abc', platform: 'tiktok.com/@someone' });
    expect(lastLine()).toMatchObject({ model: 'redacted', platform: 'redacted' });
  });

  it('allows model codes and rounds numbers', () => {
    stageLog('ai-proxy', 'ai', Date.now(), 'ok', { model: 'openai/gpt-4o-mini:online', upstream_ms: 8203.6, chars: Number.NaN });
    expect(lastLine()).toMatchObject({ model: 'openai/gpt-4o-mini:online', upstream_ms: 8204, chars: 0 });
  });

  it('ignores empty fields and cannot overwrite the core fields', () => {
    stageLog('ai-proxy', 'ai', Date.now(), 'ok', { count: undefined, extra: null, outcome: 'forged', ms: 1 });
    const line = lastLine();
    expect(line.outcome).toBe('ok');
    expect(line).not.toHaveProperty('count');
    expect(line).not.toHaveProperty('extra');
  });

  it('never throws, even if logging itself fails', () => {
    log.mockImplementation(() => { throw new Error('console closed'); });
    expect(() => stageLog('ai-proxy', 'ai', Date.now(), 'ok')).not.toThrow();
  });
});
