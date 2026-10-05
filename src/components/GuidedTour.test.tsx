import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuidedTour } from './GuidedTour';
import { TOUR_STEPS } from '../lib/tour';

describe('GuidedTour', () => {
  it('walks every step and saves the dietary picks on Done', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<GuidedTour initialDietary={['halal']} onFinish={onFinish} />);

    for (const [i, step] of TOUR_STEPS.entries()) {
      expect(screen.getByRole('heading', { name: step.title })).toBeInTheDocument();
      expect(screen.getByText(`${i + 1} of ${TOUR_STEPS.length}`)).toBeInTheDocument();
      if (i < TOUR_STEPS.length - 1) await user.click(screen.getByRole('button', { name: /next/i }));
    }

    // Last step: the dietary chips, starting from what the profile already has.
    expect(screen.getByRole('button', { name: 'Halal' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Egg-Free' }));
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(onFinish).toHaveBeenCalledWith(expect.arrayContaining(['halal', 'egg-free']));
  });

  it('Back returns to the previous step', async () => {
    const user = userEvent.setup();
    render(<GuidedTour initialDietary={[]} onFinish={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('heading', { name: TOUR_STEPS[1].title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: TOUR_STEPS[0].title })).toBeInTheDocument();
  });

  it('Skip ends the tour without changing dietary preferences', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<GuidedTour initialDietary={['vegan']} onFinish={onFinish} />);
    await user.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(onFinish).toHaveBeenCalledWith(null);
  });

  it('still shows the step when its button is not on screen', () => {
    render(<GuidedTour initialDietary={[]} onFinish={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TOUR_STEPS[0].title })).toBeInTheDocument();
  });
});
