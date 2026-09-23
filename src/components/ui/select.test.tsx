import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VenueTypeSelect } from './select';

beforeAll(() => {
  // jsdom does not implement pointer capture or scrollIntoView, which Radix uses to open.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

describe('VenueTypeSelect', () => {
  it('opens a menu in the app colours instead of a native list', async () => {
    const onChange = vi.fn();
    render(<VenueTypeSelect value="food" onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Type' }));

    const dessert = await screen.findByRole('option', { name: 'Dessert' });
    expect(screen.getByRole('option', { name: 'Bar' })).toBeInTheDocument();
    expect(dessert.closest('[data-radix-select-viewport]')?.parentElement?.className).toMatch(/bg-\[#111\]/);
    expect(dessert.className).toMatch(/data-\[highlighted\]:bg-gold\/20/);

    await userEvent.click(dessert);
    expect(onChange).toHaveBeenCalledWith('dessert');
  });
});
