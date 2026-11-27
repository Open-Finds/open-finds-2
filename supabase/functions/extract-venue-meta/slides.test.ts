import { describe, expect, it, vi } from 'vitest';

vi.mock('../_shared/auth.ts', () => ({ requireUser: vi.fn(), serviceClient: vi.fn() }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: vi.fn() }));
vi.stubGlobal('Deno', { env: { get: () => '' }, serve: () => {} });
const { carouselSlides } = await import('./index');

const BS = String.fromCharCode(92);
/** An embed page as Instagram serves it: the post's JSON inside a script string, with escaped slashes and ampersands. */
function embed(urls: string[], kind = 'GraphSidecar'): string {
  const data = JSON.stringify({ __typename: kind, edges: urls.map(url => ({ display_url: url })) })
    .split('/').join(BS + '/').split('&').join(BS + 'u0026');
  return '<script>window.x = ' + JSON.stringify(data) + ';</script>';
}

describe('carouselSlides', () => {
  it('reads each slide picture once, in order, with the cover repeat removed', () => {
    const one = 'https://scontent-syd2-1.cdninstagram.com/v/t51/111_n.jpg?stp=a&oh=1';
    const two = 'https://scontent-syd2-1.cdninstagram.com/v/t51/222_n.jpg?stp=b&oh=2';
    expect(carouselSlides(embed([one, one, two]))).toEqual([one, two]);
  });

  it('finds nothing for a single picture or video', () => {
    expect(carouselSlides(embed(['https://x.cdninstagram.com/a.jpg'], 'GraphImage'))).toEqual([]);
    expect(carouselSlides(null)).toEqual([]);
  });

  it('never passes on a link outside Instagram picture hosts', () => {
    expect(carouselSlides(embed(['https://evil.example.com/a.jpg', 'http://x.cdninstagram.com/b.jpg', 'https://y.fbcdn.net/c.jpg'])))
      .toEqual(['https://y.fbcdn.net/c.jpg']);
  });

  it('keeps at most ten slides', () => {
    const many = Array.from({ length: 14 }, (_, i) => `https://x.cdninstagram.com/${i}.jpg`);
    expect(carouselSlides(embed(many))).toHaveLength(10);
  });
});
