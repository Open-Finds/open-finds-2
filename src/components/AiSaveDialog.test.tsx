import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSaveDialog } from './AiSaveDialog';
import type { SavedVenue } from '../lib/supabase';

const mocks = vi.hoisted(() => ({
  identifySharedVenue: vi.fn(), publishVenue: vi.fn(), saveSharedVenue: vi.fn(), sendRecommendation: vi.fn(),
}));
vi.mock('../lib/aiSave', () => mocks);
vi.mock('../lib/supabase', () => ({ updateSavedVenue: vi.fn() }));
vi.mock('../lib/openai', () => ({ UserFacingError: Error }));

const saved = { id: 'saved', name: 'Test cafe', address: '1 Test St' } as SavedVenue;
const link = 'https://www.instagram.com/reel/test/';

function start() {
  let complete!: (result: { saved?: SavedVenue; candidates: [] }) => void;
  mocks.identifySharedVenue.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const onClose = vi.fn();
  const onPlan = vi.fn();
  render(<AiSaveDialog link={link} onClose={onClose} onPlan={onPlan} />);
  return { onClose, onPlan, finish: (venue?: SavedVenue) => act(async () => complete({ saved: venue, candidates: [] })) };
}

describe('AI Save', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('starts the dismissal timer only after saving', async () => {
    const flow = start();
    act(() => vi.advanceTimersByTime(5000));
    expect(flow.onClose).not.toHaveBeenCalled();
    await flow.finish(saved);
    act(() => vi.advanceTimersByTime(2999));
    expect(flow.onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(flow.onClose).toHaveBeenCalledOnce();
  });

  it('queues Plan Event and passes the persisted venue to the planner', async () => {
    const flow = start();
    fireEvent.click(screen.getByRole('button', { name: 'Plan Event' }));
    expect(flow.onPlan).not.toHaveBeenCalled();
    await flow.finish(saved);
    expect(flow.onPlan).toHaveBeenCalledOnce();
    expect(flow.onPlan).toHaveBeenCalledWith(saved);
    act(() => vi.advanceTimersByTime(5000));
    expect(flow.onClose).not.toHaveBeenCalled();
  });

  it('opens the queued composer after saving and keeps it open on cancellation', async () => {
    mocks.publishVenue.mockResolvedValue('https://www.theunsaved.app/v/id');
    mocks.sendRecommendation.mockResolvedValue('cancelled');
    const flow = start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(mocks.publishVenue).not.toHaveBeenCalled();
    await flow.finish(saved);
    expect(mocks.publishVenue).toHaveBeenCalledWith(saved);
    expect(screen.getByLabelText('Message (optional)')).toHaveValue("Let's check this out! 🤩");
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share recommendation' })));
    expect(mocks.sendRecommendation).toHaveBeenCalledWith("Let's check this out! 🤩", 'https://www.theunsaved.app/v/id');
    act(() => vi.advanceTimersByTime(5000));
    expect(flow.onClose).not.toHaveBeenCalled();
  });

  it('requires correction and keeps a queued action pending without a saved venue', async () => {
    const flow = start();
    fireEvent.click(screen.getByRole('button', { name: 'Plan Event' }));
    await flow.finish();
    expect(screen.getByLabelText('Venue name')).toBeInTheDocument();
    expect(flow.onPlan).not.toHaveBeenCalled();
    expect(flow.onClose).not.toHaveBeenCalled();
  });

  it('allows manual dismissal during extraction', () => {
    const flow = start();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(flow.onClose).toHaveBeenCalledOnce();
    expect(flow.onPlan).not.toHaveBeenCalled();
  });
});
