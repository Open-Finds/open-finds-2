import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AndroidShareSheet, PendingAndroidSharePlan } from './AndroidShareSheet';
import type { SharedVenue, SharedVenueProgress } from '../lib/aiSave';

const mocks = vi.hoisted(() => ({
  owner: undefined as string | undefined,
  listeners: new Map<string, () => void>(),
  getShare: vi.fn(),
  remember: vi.fn().mockResolvedValue(undefined),
  dismiss: vi.fn().mockResolvedValue(undefined),
  openPlan: vi.fn().mockResolvedValue(undefined),
  takePlan: vi.fn(),
  working: vi.fn().mockResolvedValue(undefined),
  background: vi.fn().mockResolvedValue({ moved: true }),
  ready: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: mocks.owner ? { user: { id: mocks.owner } } : null, loading: false }),
}));
vi.mock('../pages/Login', () => ({ LoginPage: () => <p>Email sign-in</p> }));
vi.mock('../lib/aiSave', async original => ({
  ...await original<typeof import('../lib/aiSave')>(),
  nativeShare: {
    ...mocks,
    addListener: async (event: string, fn: () => void) => {
      mocks.listeners.set(event, fn);
      return { remove: async () => { if (mocks.listeners.get(event) === fn) mocks.listeners.delete(event); } };
    },
  },
}));
const link = 'https://www.instagram.com/reel/example/';
const sharedVenue = { name: 'Test Cafe', address: '1 Test St', type: 'food', link } as const;
vi.mock('./AiSaveDialog', () => ({
  AiSaveDialog: ({ link, sharedText, initialProgress, onProgress, onPlan, onClose, onBackground, onReady, closeRequest, instant }: {
    link: string; sharedText?: string; initialProgress?: SharedVenueProgress; onProgress: (progress: SharedVenueProgress) => void;
    onPlan: (venue: SharedVenue) => void; onClose: () => void;
    onBackground: () => Promise<boolean>; onReady: (found: boolean) => void; closeRequest: number; instant: boolean;
  }) => <>
    <p data-testid="instant">{String(instant)}</p>
    <p data-testid="close-requests">{closeRequest}</p>
    <button onClick={() => { void onBackground(); }}>Go behind</button>
    <button onClick={() => onReady(true)}>Ready</button>
    <p>{link}</p><p>{initialProgress?.verified?.name}</p><p data-testid="shared-text">{'shared: ' + (sharedText ?? '')}</p>
    <button onClick={() => onProgress({ verified: sharedVenue })}>Finish verification</button>
    <button onClick={() => onProgress({ candidates: [{ ...sharedVenue, order: 1, tags: [] }], identification: { structuredAddress: true } })}>Pause verification</button>
    <button onClick={() => onPlan(sharedVenue)}>Create Plan</button>
    <button onClick={onClose}>Dismiss</button>
  </>,
}));

beforeEach(() => {
  mocks.owner = undefined;
  mocks.listeners.clear();
  mocks.getShare.mockReset().mockResolvedValue({});
  mocks.takePlan.mockReset().mockResolvedValue({});
  vi.clearAllMocks();
});

it('keeps the shared link through sign-in and dismisses through the Android activity', async () => {
  const initialShare = { id: 'first', text: 'Shared from Instagram ' + link };
  const view = render(<AndroidShareSheet initialShare={initialShare} />);
  expect(screen.getByRole('heading', { name: 'AI Save or Create Plan' })).toBeInTheDocument();
  expect(screen.getByText('Email sign-in')).toBeInTheDocument();

  mocks.owner = 'owner';
  await act(async () => view.rerender(<AndroidShareSheet initialShare={initialShare} />));
  expect(screen.getByText(link)).toBeInTheDocument();
  // The whole shared text (TikTok puts the caption beside the link) goes to AI Save, not only the link.
  expect(screen.getByTestId('shared-text')).toHaveTextContent('shared: Shared from Instagram ' + link);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(mocks.dismiss).toHaveBeenCalledOnce();
  expect(mocks.dismiss).toHaveBeenCalledWith({ id: 'first' });
  expect(mocks.openPlan).not.toHaveBeenCalled();
});

it('restores completed verification for the same account and switches to the latest share', async () => {
  mocks.owner = 'owner';
  const initialShare = { id: 'first', text: link,
    checkpoint: JSON.stringify({ owner: 'owner', progress: { verified: sharedVenue } }) };
  await act(async () => render(<AndroidShareSheet initialShare={initialShare} />));
  expect(screen.getByText('Test Cafe')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Finish verification' }));
  expect(mocks.remember).toHaveBeenCalledWith({ id: 'first', value: initialShare.checkpoint });
  fireEvent.click(screen.getByRole('button', { name: 'Create Plan' }));
  expect(mocks.openPlan).toHaveBeenCalledWith({ id: 'first', value: JSON.stringify({ owner: 'owner', venue: sharedVenue }) });

  const next = 'https://www.tiktok.com/@test/video/123';
  mocks.getShare.mockResolvedValueOnce({ id: 'second', text: next });
  await act(async () => mocks.listeners.get('incoming')?.());
  expect(screen.getByText(next)).toBeInTheDocument();
  expect(screen.queryByText('Test Cafe')).not.toBeInTheDocument();
});

it('does not restore a checkpoint or open a plan for another account', async () => {
  mocks.owner = 'other';
  const onPlan = vi.fn();
  mocks.takePlan.mockResolvedValueOnce({ value: JSON.stringify({ owner: 'owner', venue: sharedVenue }) });
  await act(async () => render(<>
    <AndroidShareSheet initialShare={{ id: 'first', text: link,
      checkpoint: JSON.stringify({ owner: 'owner', progress: { verified: sharedVenue } }) }} />
    <PendingAndroidSharePlan owner="other" onPlan={onPlan} />
  </>));
  expect(screen.queryByText('Test Cafe')).not.toBeInTheDocument();
  expect(onPlan).not.toHaveBeenCalled();
  mocks.takePlan.mockResolvedValueOnce({ value: JSON.stringify({ owner: 'other', venue: sharedVenue }) });
  await act(async () => mocks.listeners.get('plan')?.());
  await waitFor(() => expect(onPlan).toHaveBeenCalledWith(sharedVenue));
});

it('checkpoints source address evidence for a verification retry after recreation', async () => {
  mocks.owner = 'owner';
  await act(async () => render(<AndroidShareSheet initialShare={{ id: 'first', text: link }} />));
  fireEvent.click(screen.getByRole('button', { name: 'Pause verification' }));
  const [{ id, value }] = mocks.remember.mock.calls[0];
  expect(id).toBe('first');
  expect(JSON.parse(value)).toEqual({
    owner: 'owner',
    progress: {
      candidates: [{ ...sharedVenue, order: 1, tags: [] }],
      identification: { structuredAddress: true },
    },
  });
});

it('passes background search, readiness and the back button between Android and the search screen', async () => {
  mocks.owner = 'owner';
  await act(async () => { render(<AndroidShareSheet initialShare={{ id: 'first', text: link }} />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go behind' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
  expect(mocks.background).toHaveBeenCalledWith({ id: 'first' });
  expect(mocks.ready).toHaveBeenCalledWith({ id: 'first', found: true });
  await act(async () => mocks.listeners.get('close')?.());
  expect(screen.getByTestId('close-requests')).toHaveTextContent('1');
});

it('returns to the video for a new share, but not for a screen that already has progress', async () => {
  mocks.owner = 'owner';
  const fresh = render(<AndroidShareSheet initialShare={{ id: 'first', text: link }} />);
  expect(screen.getByTestId('instant')).toHaveTextContent('true');
  fresh.unmount();
  await act(async () => { render(<AndroidShareSheet initialShare={{ id: 'second', text: link,
    checkpoint: JSON.stringify({ owner: 'owner', progress: { verified: sharedVenue } }) }} />); });
  expect(screen.getByTestId('instant')).toHaveTextContent('false');
});

it('gives each share its own screen, so a search in the background is not replaced', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  expect(manifest).toContain('android:documentLaunchMode="always"');
  expect(manifest).toContain('android:foregroundServiceType="shortService"');
  expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
});

it('registers the Android send intent on the translucent activity and keeps launcher routing separate', () => {
  const parser = new DOMParser();
  const manifest = parser.parseFromString(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8'), 'application/xml');
  const ns = 'http://schemas.android.com/apk/res/android';
  const activity = (name: string) => [...manifest.getElementsByTagName('activity')].find(node => node.getAttributeNS(ns, 'name') === name);
  const actions = (name: string) => [...activity(name)!.getElementsByTagName('action')].map(node => node.getAttributeNS(ns, 'name'));
  expect(actions('.MainActivity')).toEqual(['android.intent.action.MAIN']);
  expect(actions('.ShareActivity')).toEqual(['android.intent.action.SEND']);
  expect(activity('.ShareActivity')?.getAttributeNS(ns, 'theme')).toBe('@style/AppTheme.Share');
  expect(activity('.ShareActivity')?.getElementsByTagName('data')[0].getAttributeNS(ns, 'mimeType')).toBe('text/plain');
  const styles = readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
  expect(styles).toContain('<item name="android:windowIsTranslucent">true</item>');
  expect([...manifest.getElementsByTagName('uses-permission')].map(node => node.getAttributeNS(ns, 'name')))
    .not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
});
