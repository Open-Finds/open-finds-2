import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneCheck } from './PhoneCheck';
import type { PhoneProbe } from '../lib/phoneProbe';

const mocks = vi.hoisted(() => ({ enabled: true, probe: vi.fn(), copy: vi.fn() }));
vi.mock('../lib/phoneProbe', async original => ({
  ...(await original<typeof import('../lib/phoneProbe')>()),
  phoneCheckEnabled: () => mocks.enabled,
  probePost: mocks.probe,
}));
vi.mock('../lib/invite', () => ({ copyToClipboard: mocks.copy }));

const link = 'https://vt.tiktok.com/ZSsFTaXA9/';
const result: PhoneProbe = {
  platform: 'tiktok', via: 'phone', reached: true, status: 200, finalHost: 'www.tiktok.com', htmlKB: 412, media: 'reachable (206, image/jpeg)',
  page: { loginWall: false, captionChars: 640, locationTag: false, photoSlides: 5, videoLink: false, keysSeen: ['desc', 'imagePost'] },
};

beforeEach(() => { vi.resetAllMocks(); mocks.enabled = true; });

describe('the phone check panel', () => {
  it('shows nothing outside the test build or for other links', () => {
    mocks.enabled = false;
    const { container } = render(<PhoneCheck link={link} />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('checks by itself, then lists what the phone could read', async () => {
    mocks.probe.mockResolvedValue(result);
    await act(async () => render(<PhoneCheck link={link} />));
    expect(mocks.probe).toHaveBeenCalledWith(link);
    expect(screen.getByText('Phone check (test build): done')).toBeInTheDocument();
    for (const line of ['Caption: 640 characters', 'Photo slides: 5', 'Media file: reachable (206, image/jpeg)', 'Location tag: no']) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it('says it is checking until the answer arrives', async () => {
    mocks.probe.mockReturnValue(new Promise(() => undefined));
    await act(async () => render(<PhoneCheck link={link} />));
    expect(screen.getByText('Phone check (test build): checking…')).toBeInTheDocument();
  });

  it('copies the whole result, with the link, for pasting into a message', async () => {
    mocks.probe.mockResolvedValue(result);
    mocks.copy.mockResolvedValue(true);
    await act(async () => render(<PhoneCheck link={link} />));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy results' })));
    const text = mocks.copy.mock.calls[0][0] as string;
    expect(text).toContain(link);
    expect(text).toContain('Photo slides: 5');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
