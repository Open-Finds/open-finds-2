import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateDietaryPreferences = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/supabase', () => ({
  updateDietaryPreferences: (...a: unknown[]) => updateDietaryPreferences(...a),
}));

const { Onboarding } = await import('./Onboarding');

/**
 * The dietary step sits one past the end of the STEPS array. The component
 * used to index STEPS[step] unconditionally and read .icon from it, so every
 * user who clicked Next to the end crashed to the error boundary. This walks
 * the whole thing.
 */
describe('Onboarding', () => {
  it('walks every step to the dietary screen without crashing, then completes', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    expect(screen.getByText('Save a venue from any link')).toBeInTheDocument();

    const expected = [
      'Organise into collections',
      'Build collections together',
      'Plan a night out',
      /Invite friends/,
      'On the night',
      'Plan trips too',
    ];
    for (const title of expected) {
      await user.click(screen.getByRole('button', { name: /^next/i }));
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // One more Next lands on the dietary step — the one that used to throw.
    await user.click(screen.getByRole('button', { name: /^next/i }));
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /get started/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(true));
    expect(updateDietaryPreferences).toHaveBeenCalled();
  });

  it('renders 8 progress dots: 7 workflow steps plus dietary', () => {
    const { container } = render(<Onboarding onComplete={vi.fn()} />);
    // Dots are the h-2 rounded-full pips in the progress row.
    const dots = container.querySelectorAll('.h-2.rounded-full');
    expect(dots.length).toBe(8);
  });

  it('Skip completes immediately', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onComplete).toHaveBeenCalledWith(true);
  });
});
