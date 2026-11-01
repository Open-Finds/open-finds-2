import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
describe('notification click destinations', () => {
  it.each([
    ['https://evil.example/', '/'], ['//evil.example/path', '/'], ['javascript:alert(1)', '/'],
    ['https://user:pass@theunsaved.app/', '/'],
    ['/plan/123/dashboard', '/#/plan/123/dashboard'], ['/#/plan/123', '/#/plan/123'],
    ['https://theunsaved.app/#/plan/123', '/#/plan/123'],
  ])('handles %s safely', async (destination, expected) => {
    let click: (event: unknown) => void = () => {};
    let work: Promise<unknown> = Promise.resolve();
    const openWindow = vi.fn();
    runInNewContext(source, { URL, self: {
      location: { origin: 'https://theunsaved.app' },
      addEventListener: (type: string, callback: typeof click) => { if (type === 'notificationclick') click = callback; },
      clients: { matchAll: async () => [], openWindow },
    } });
    click({ notification: { data: { url: destination }, close: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => { work = promise; } });
    await work;
    expect(openWindow).toHaveBeenCalledWith(expected);
  });
});
