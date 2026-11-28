import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSaveResultsPanel } from './AiSaveResultsPanel';
import type { AiSaveResult } from '../lib/aiSaveResults';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), copy: vi.fn() }));
vi.mock('../lib/aiSaveResults', async original => ({ ...(await original<typeof import('../lib/aiSaveResults')>()), fetchAiSaveResults: mocks.fetch }));
vi.mock('../lib/invite', () => ({ copyToClipboard: mocks.copy }));

const row = (over: Partial<AiSaveResult> = {}): AiSaveResult => ({
  user_id: 'u', attempt_id: crypto.randomUUID(), created_at: '2026-11-25T10:00:00Z', updated_at: '2026-11-25T10:00:00Z',
  platform: 'tiktok', post_kind: 'video', link: 'https://www.tiktok.com/@a/video/1', outcome: 'confirmed', found_by: 'caption', venue_name: 'Ocean Royale',
  venue_count: 1, saved_venue_id: null, edited: false, used_none_of_these: false, used_pasted_caption: false, duration_ms: 9000, rating: null, reason: null, note: null, ...over,
});

beforeEach(() => vi.resetAllMocks());

describe('the AI Save results tab', () => {
  it('shows the success rate and the breakdowns', async () => {
    mocks.fetch.mockResolvedValue([row({ rating: 'like' }), row({ rating: 'like' }), row({ rating: 'dislike', reason: 'wrong_venue', venue_name: 'Oyama Ramen' }),
      row({ platform: 'instagram', post_kind: 'video', found_by: 'shared_text' })]);
    await act(async () => render(<AiSaveResultsPanel />));
    expect(screen.getByText('Saves tracked').nextSibling).toHaveTextContent('4');
    expect(screen.getAllByText('Rated')[0].nextSibling).toHaveTextContent('3');
    // 2 of 3 rated are thumbs up.
    expect(screen.getAllByText('👍 of rated')[0].nextSibling).toHaveTextContent('67%');
    const bySite = screen.getByRole('heading', { name: 'By site and kind of post' }).parentElement as HTMLElement;
    expect(within(bySite).getByText('tiktok video')).toBeInTheDocument();
    expect(within(bySite).getByText('instagram video')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'By how the venue was found' })).toBeInTheDocument();
  });

  it('lists what was marked wrong, with the reason and the link', async () => {
    mocks.fetch.mockResolvedValue([row({ rating: 'dislike', reason: 'wrong_venue', note: 'Saved the wrong pizza place', venue_name: 'Oyama Ramen' })]);
    await act(async () => render(<AiSaveResultsPanel />));
    expect(screen.getByRole('heading', { name: 'Marked wrong (1)' })).toBeInTheDocument();
    expect(screen.getByText(/saved Oyama Ramen/)).toBeInTheDocument();
    expect(screen.getByText(/Wrong venue/)).toHaveTextContent('Saved the wrong pizza place');
    expect(screen.getByRole('link', { name: 'https://www.tiktok.com/@a/video/1' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('copies the wrong ones as test-set rows', async () => {
    mocks.copy.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue([row({ rating: 'dislike', reason: 'wrong_venue' })]);
    await act(async () => render(<AiSaveResultsPanel />));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy as test-set rows' })));
    expect(mocks.copy.mock.calls[0][0]).toContain('https://www.tiktok.com/@a/video/1');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says so when there is nothing yet, and when the results cannot be read', async () => {
    mocks.fetch.mockResolvedValueOnce([]);
    const view = await act(async () => render(<AiSaveResultsPanel />));
    expect(screen.getByText(/No results yet/)).toBeInTheDocument();
    view.unmount();
    mocks.fetch.mockRejectedValueOnce(new Error('denied'));
    await act(async () => render(<AiSaveResultsPanel />));
    expect(screen.getByRole('alert')).toHaveTextContent('Only an admin can see them');
  });

  it('loads again when Refresh is tapped', async () => {
    mocks.fetch.mockResolvedValue([row()]);
    await act(async () => render(<AiSaveResultsPanel />));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
