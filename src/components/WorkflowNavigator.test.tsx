import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkflowNavigator } from './WorkflowNavigator';
afterEach(() => vi.restoreAllMocks());
it('follows scroll position, focuses the destination, and yields to editing and sheets', async () => {
  const discover = createRef<HTMLElement>(), itinerary = createRef<HTMLElement>();
  let top = 1000;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return { top: this.id === 'itinerary' ? top : 0, bottom: 800, left: 0, right: 0, width: 0, height: 800, x: 0, y: 0, toJSON: () => ({}) }; });
  const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  const sections = [{ label: 'Discover', target: discover }, { label: 'Itinerary', target: itinerary }];
  const view = render(<><section id="discover" ref={discover} tabIndex={-1} /><section id="itinerary" ref={itinerary} tabIndex={-1}><input aria-label="Event name" /></section><WorkflowNavigator sections={sections} /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Go to Itinerary' }));
  expect(scroll).toHaveBeenCalled(); expect(document.activeElement).toBe(itinerary.current);
  top = 100; fireEvent.scroll(window);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Previous section: Discover' })).toBeInTheDocument());
  act(() => screen.getByLabelText('Event name').focus());
  await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Planner sections' })).not.toBeInTheDocument());
  act(() => screen.getByLabelText('Event name').blur());
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Planner sections' })).toBeInTheDocument());
  view.rerender(<WorkflowNavigator sections={sections} blocked />);
  expect(screen.queryByRole('navigation', { name: 'Planner sections' })).not.toBeInTheDocument();
});


it('tracks viewed scroll percentage and recalculates when disclosed content changes height', async () => {
  vi.stubGlobal('innerHeight', 800);
  let notify!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} });
  let offset = 0, extra = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = (this.id === 'review' ? 2600 : 200) - offset, height = this.id === 'review' ? 400 + extra : 1000;
    return { top, bottom: top + height, height, width: 0, left: 0, right: 0, x: 0, y: top, toJSON: () => ({}) };
  });
  const first = createRef<HTMLElement>(), last = createRef<HTMLElement>();
  render(<><section id="discover" ref={first} /><section id="review" ref={last} /><WorkflowNavigator sections={[{ label: 'Discover', target: first }, { label: 'Review', target: last }]} /></>);
  const bar = screen.getByRole('progressbar', { name: 'Planner scroll progress' });
  expect(bar).toHaveAttribute('aria-valuenow', '0');
  offset = 1000; fireEvent.scroll(window);
  await waitFor(() => expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0));
  expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
  offset = 2310; fireEvent.scroll(window);
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '100'));
  extra = 400; act(() => notify());
  await waitFor(() => expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(100));
  offset = 0; fireEvent.scroll(window);
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '0'));
  vi.unstubAllGlobals();
});
