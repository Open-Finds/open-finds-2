import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSelect, TimeSelect, VenueTypeSelect } from './select';

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

describe('AppSelect', () => {
  it('renders placeholder and selects an option with gold menu chrome', async () => {
    const onChange = vi.fn();
    render(
      <AppSelect
        value=""
        onChange={onChange}
        placeholder="Add a friend..."
        ariaLabel="Add a friend to group"
        options={[
          { value: '1', label: 'Alex (@alex)' },
          { value: '2', label: 'Sam (@sam)' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Add a friend to group' }));
    const alex = await screen.findByRole('option', { name: 'Alex (@alex)' });
    expect(alex.closest('[data-radix-select-viewport]')?.parentElement?.className).toMatch(/bg-\[#111\]/);
    await userEvent.click(alex);
    expect(onChange).toHaveBeenCalledWith('1');
  });
});

describe('TimeSelect', () => {
  it('updates 24h time from hour minute and period menus', async () => {
    const onChange = vi.fn();
    render(<TimeSelect value="21:30" onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Hour' }));
    await userEvent.click(await screen.findByRole('option', { name: '10' }));
    expect(onChange).toHaveBeenCalledWith('22:30');

    onChange.mockClear();
    await userEvent.click(screen.getByRole('combobox', { name: 'AM or PM' }));
    await userEvent.click(await screen.findByRole('option', { name: 'AM' }));
    expect(onChange).toHaveBeenCalledWith('09:30');
  });
});
