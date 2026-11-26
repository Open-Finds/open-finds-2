import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { describeItem, putInInbox, readInbox, removeFromInbox, SEARCH_LIMIT_MS, storedResult } from './aiSaveInbox';
import { NotificationsPage } from '../pages/Notifications';
import { AiSaveDialog } from '../components/AiSaveDialog';
import { UserFacingError } from './openai';

const mocks = vi.hoisted(() => ({ identify: vi.fn(), save: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) } },
  fetchNotifications: async () => [], markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn(), updateSavedVenue: vi.fn(),
}));
vi.mock('./aiSave', () => ({ identifySharedVenue: mocks.identify, saveSharedVenue: mocks.save, shareRecommendationOrigin: () => null }));
vi.mock('./aiSaveResults', async original => ({ ...(await original<typeof import('./aiSaveResults')>()), recordAiSaveResult: async () => true }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, refreshProfile: vi.fn() }) }));

const link = 'https://www.tiktok.com/@a/video/1';
const venue = { name: 'Test Cafe', address: '1 Test St', type: 'food' as const, link, lat: 1, lon: 2 };
const result = { venue, candidates: [{ ...venue, order: 1, tags: [] }] };

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it('keeps a finished result for this account with no time limit, until it is removed', async () => {
  await putInInbox({ link, at: Date.now() - 400 * 24 * 60 * 60 * 1000, finished: true, result });
  expect(readInbox('me')).toHaveLength(1);
  expect(readInbox('someone-else')).toEqual([]);
  expect(describeItem(readInbox('me')[0])).toMatchObject({ title: 'Test Cafe', ready: true });
  await removeFromInbox(link);
  expect(readInbox('me')).toEqual([]);
});

it('says a search is running, then that it did not finish, and keeps a readable problem', async () => {
  const at = Date.now();
  expect(describeItem({ link, at, finished: false }, at + 1000).ready).toBe(false);
  expect(describeItem({ link, at, finished: false }, at + SEARCH_LIMIT_MS + 1).title).toBe("AI Save didn't finish");
  await putInInbox({ link, at, finished: true, result: { candidates: [], issue: { stage: 'identify', retryable: true, cause: new UserFacingError('Could not read it.') } } });
  const [item] = readInbox('me');
  expect(describeItem(item).title).toBe('No venue found');
  expect(storedResult(item)?.issue?.cause).toEqual(new UserFacingError('Could not read it.'));
});

it('lists the result in Notifications, to open or remove', async () => {
  await putInInbox({ link, at: Date.now(), finished: true, result });
  const open = vi.fn();
  await act(async () => { render(<NotificationsPage onBack={vi.fn()} onOpenFriends={vi.fn()} onOpenAiSave={open} />); });
  expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Test Cafe'));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ link }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Test Cafe' })); });
  expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
});

it('reopens a stored result without searching again, and clears it only once saved', async () => {
  await putInInbox({ link, at: Date.now(), finished: true, result });
  mocks.save.mockResolvedValue({ ...venue, id: 'saved' });
  await act(async () => { render(<AiSaveDialog link={link} stored={readInbox('me')[0]} onClose={vi.fn()} onPlan={vi.fn()} />); });
  expect(mocks.identify).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(readInbox('me')).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Venue' })); });
  expect(readInbox('me')).toEqual([]);
});

it('puts a new search in Notifications as soon as it starts, then its result', async () => {
  let finish!: (value: typeof result) => void;
  mocks.identify.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await act(async () => { render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} />); });
  expect(readInbox('me')).toMatchObject([{ link, finished: false }]);
  await act(async () => finish(result));
  expect(readInbox('me')).toMatchObject([{ link, finished: true, result: { venue: { name: 'Test Cafe' } } }]);
});
