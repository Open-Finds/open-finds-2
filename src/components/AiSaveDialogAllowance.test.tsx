import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSaveDialog } from './AiSaveDialog';
import type { SharedVenueResult } from '../lib/aiSave';

const mocks = vi.hoisted(() => ({
  identifySharedVenue: vi.fn(), publishVenue: vi.fn(), saveSharedVenue: vi.fn(), sendRecommendationLink: vi.fn(), sendRecommendationMessage: vi.fn(),
  shareRecommendationOrigin: () => 'https://www.theunsaved.app',
}));
vi.mock('../lib/aiSave', () => mocks);
vi.mock('../lib/supabase', () => ({ updateSavedVenue: vi.fn() }));
vi.mock('../lib/openai', () => ({ UserFacingError: Error, captionFromShare: (text?: string) => (text ?? '').replace(/https?:\/\/\S+/g, '').trim() }));
const results = vi.hoisted(() => ({ record: vi.fn<(input: import('../lib/aiSaveResults').AiSaveResultInput) => Promise<boolean>>(async () => true) }));
vi.mock('../lib/aiSaveResults', async original => ({ ...(await original<typeof import('../lib/aiSaveResults')>()), recordAiSaveResult: results.record }));

const link = 'https://www.instagram.com/reel/test/';
const venue = { name: 'Test cafe', address: '1 Test St', type: 'food' as const, link, lat: 1, lon: 2 };
const candidate = { ...venue, order: 1, tags: [] };

async function start(result: SharedVenueResult) {
  mocks.identifySharedVenue.mockResolvedValueOnce(result);
  await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} />));
}

describe('testing allowance messages', () => {
  beforeEach(() => vi.resetAllMocks());

  it('tells the person how long to wait, and keeps retry and manual saving available', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: true, reason: 'testing_limit', retryAfterSeconds: 723 } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("You've reached the testing limit. Try again in 13 minutes.");
    expect(alert).not.toHaveTextContent(/could not verify|could not match|could not identify/i);
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
    expect(screen.getByLabelText('Address')).toHaveValue(venue.address);
  });

  it.each([
    [30, 'less than a minute'], [60, '1 minute'], [61, '2 minutes'], [1800, '30 minutes'],
  ])('words a %i second wait as "%s"', async (seconds, text) => {
    await start({ candidates: [candidate], issue: { stage: 'identify', retryable: true, reason: 'testing_limit', retryAfterSeconds: seconds } });
    expect(screen.getByRole('alert')).toHaveTextContent(`You've reached the testing limit. Try again in ${text}.`);
    expect(screen.getByRole('button', { name: 'Retry identification' })).toBeEnabled();
  });

  it('does not invent a wait when the server gave none', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: true, reason: 'testing_limit' } });
    expect(screen.getByRole('alert')).toHaveTextContent("You've reached the testing limit. Try again later.");
    expect(screen.getByRole('alert')).not.toHaveTextContent(/minute/);
  });

  it.each([
    ['attempt_expired', 'This attempt timed out'],
    ['attempt_limit', 'This attempt made too many requests'],
  ] as const)('explains an %s attempt and offers a fresh try or manual entry', async (reason, text) => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: true, reason } });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
  });
});
