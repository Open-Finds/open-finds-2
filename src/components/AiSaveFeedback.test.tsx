import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AiSaveFeedback, type FeedbackValue } from './AiSaveFeedback';

/** The component is controlled by its parent, so the tests keep the value the way the dialog does. */
function Harness({ onRate }: { onRate: (value: FeedbackValue) => void }) {
  const [value, setValue] = useState<FeedbackValue>();
  return <AiSaveFeedback value={value} onRate={next => { setValue(next); onRate(next); }} />;
}

describe('the thumbs up and down', () => {
  it('asks the question with a Yes and a No', () => {
    render(<Harness onRate={vi.fn()} />);
    expect(screen.getByText('Was this the right venue?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('records a thumbs up and says thanks', () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onRate).toHaveBeenCalledWith({ rating: 'like' });
    expect(screen.getByRole('status')).toHaveTextContent('Thanks, noted.');
  });

  it('records a thumbs down straight away, then takes a reason with one tap', () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onRate).toHaveBeenLastCalledWith({ rating: 'dislike' });
    expect(screen.getByText('Sorry about that. What went wrong?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wrong venue' }));
    expect(onRate).toHaveBeenLastCalledWith({ rating: 'dislike', reason: 'wrong_venue', note: undefined });
    expect(screen.getByRole('button', { name: 'Wrong venue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wrong address' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds an optional note to the same record, and keeps the reason', () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Missed a venue' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Add a note (optional)'), { target: { value: '  Only found one of three  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onRate).toHaveBeenLastCalledWith({ rating: 'dislike', reason: 'missing_venue', note: 'Only found one of three' });
  });

  it('lets the answer be changed', () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByText('Was this the right venue?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onRate).toHaveBeenLastCalledWith({ rating: 'dislike' });
    fireEvent.click(screen.getByRole('button', { name: 'Change my answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onRate).toHaveBeenLastCalledWith({ rating: 'like' });
  });
});
