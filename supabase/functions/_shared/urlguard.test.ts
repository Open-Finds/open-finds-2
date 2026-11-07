import { describe, it, expect, vi } from 'vitest';
import { assertPublicUrl, safeFetch, followRedirects } from './urlguard';

describe('server fetch destination guard', () => {
  it.each(['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fe90::1]/',
    'http://[febf::1]/', 'http://[fc00::1]/', 'http://[::1]/', 'http://[2001:20::1]/',
    'http://[2002:7f00:1::]/', 'http://localhost./',
    'http://metadata.google.internal./', 'file:///etc/passwd', 'http://user:pass@example.com/'])('rejects %s', (url) => {
    expect(assertPublicUrl(url).ok).toBe(false);
  });
  it.each(['https://example.com/', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/'])('accepts public %s', (url) => {
    expect(assertPublicUrl(url).ok).toBe(true);
  });
  it('rejects hostnames resolving to private addresses without fetching', async () => {
    vi.stubGlobal('Deno', { resolveDns: vi.fn(async () => ['127.0.0.1']) });
    expect(await safeFetch('https://public-looking.example/')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects mixed public A and private AAAA records', async () => {
    vi.stubGlobal('Deno', { resolveDns: vi.fn(async (_h, family) => family === 'A' ? ['8.8.8.8'] : ['::ffff:7f00:1']) });
    expect(await safeFetch('https://example.com/')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed on DNS failure', async () => {
    vi.stubGlobal('Deno', { resolveDns: vi.fn().mockRejectedValue(new Error('DNS failure')) });
    expect(await safeFetch('https://example.com/')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows public destinations and preserves request options', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('ok'));
    expect(await (await safeFetch('https://example.com/', { method: 'GET' }))?.text()).toBe('ok');
    expect(fetch).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({ redirect: 'manual', method: 'GET' }));
  });
  it('blocks a redirect into loopback', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/' } }));
    expect(await safeFetch('https://example.com/')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('resolves and checks redirect hostnames before fetching them', async () => {
    vi.stubGlobal('Deno', { resolveDns: vi.fn(async (host) => host === 'example.com' ? ['8.8.8.8'] : ['10.0.0.1']) });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://other.example/' } }));
    expect(await safeFetch('https://example.com/')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('applies the same DNS checks to shortened-link expansion', async () => {
    vi.stubGlobal('Deno', { resolveDns: vi.fn(async () => ['169.254.169.254']) });
    expect(await followRedirects('https://example.com/')).toBe('https://example.com/');
    expect(fetch).not.toHaveBeenCalled();
  });
});
