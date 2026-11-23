import { afterEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { getShareUrl, shareOrCopy } from './invite';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./nativeShare', () => ({ nativeShare: { send } }));

afterEach(() => {
  vi.restoreAllMocks();
  send.mockReset();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'clipboard');
});

it('uses the configured staging host for an Android itinerary link', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
  vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', 'https://staging.example.test');
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  send.mockResolvedValue(undefined);
  const link = getShareUrl('plan-id');
  expect(link).toBe('https://staging.example.test/#/plan/plan-id/rsvp');
  await expect(shareOrCopy('Plan', 'Join me', link)).resolves.toBe('shared');
  expect(send).toHaveBeenCalledWith({ text: 'Join me\n' + link });
});

it.each(['', 'https://localhost', 'https://www.theunsaved.app', 'https://127.0.0.1'])(
  'disables itinerary links when the staging origin is unsafe or missing (%s)', origin => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://crpkzysdtnoomzimibhe.supabase.co');
    vi.stubEnv('VITE_STAGING_RECOMMENDATION_ORIGIN', origin);
    expect(getShareUrl('plan-id')).toBe('');
  },
);

it('copies the complete invitation if the Android chooser fails', async () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
  send.mockRejectedValue(new Error('No chooser'));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const url = 'https://staging.example.test/#/plan/plan-id/rsvp';
  await expect(shareOrCopy('Plan', 'Join me', url)).resolves.toBe('copied');
  expect(writeText).toHaveBeenCalledWith('Join me\n' + url);
});
