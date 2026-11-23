import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryCounters } from './CategoryCounters';
import type { Category } from '../lib/taxonomy';

const none: Record<Category, number> = { food: 0, dessert: 0, cafe: 0, bar: 0, activity: 0, nightlife: 0, outdoors: 0 };

describe('CategoryCounters', () => {
  it('shows all seven categories in a four-column grid with Cafe, Nature and Nightlife by name', () => {
    render(<CategoryCounters counts={none} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Category preferences').className).toContain('grid-cols-4');
    for (const label of ['Food', 'Dessert', 'Cafe', 'Bar', 'Nightlife', 'Activity', 'Nature']) {
      expect(screen.getByTitle(label)).toBeTruthy();
    }
    expect(screen.getByText('· optional · 0/6 preferences')).toBeTruthy();
  });

  it('stops adding stops once the total reaches six', () => {
    const onChange = vi.fn();
    render(<CategoryCounters counts={{ ...none, food: 2, bar: 2, dessert: 1, nightlife: 1 }} onChange={onChange} />);
    expect((screen.getByLabelText('More Cafe stops') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('More Cafe stops'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the user remove a stop from a category that has one', () => {
    const onChange = vi.fn();
    render(<CategoryCounters counts={{ ...none, cafe: 1 }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Fewer Cafe stops'));
    expect(onChange).toHaveBeenCalledWith('cafe', -1);
  });
});
