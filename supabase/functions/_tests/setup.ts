import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  // Any unmocked network call is a test failure, never a real backend request.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network disabled in security tests'); }));
  vi.stubGlobal('Deno', { env: { get: () => 'security-test-placeholder' }, serve: vi.fn(),
    resolveDns: vi.fn(async (_host: string, family: string) => family === 'A' ? ['93.184.216.34'] : []) });
});
