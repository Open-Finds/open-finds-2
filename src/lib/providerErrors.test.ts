import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError, asProviderError, providerFailure, waitText } from './providerErrors';

const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

describe('providerFailure', () => {
  it.each([
    [429, { code: 'testing_limit', retry_after_seconds: 723 }, 'testing_limit', 723],
    [410, { code: 'attempt_expired' }, 'attempt_expired', undefined],
    [429, { code: 'attempt_request_limit' }, 'attempt_limit', undefined],
    [429, { code: 'user_rate_limit', retry_after_seconds: 3 }, 'limit', 3],
    [409, { code: 'request_in_progress', retry_after_seconds: 2 }, 'busy', 2],
    [409, { code: 'duplicate_request' }, 'duplicate', undefined],
    [409, { code: 'campaign_busy' }, 'busy', undefined],
    [429, { code: 'budget_exhausted' }, 'limit', undefined],
    [401, undefined, 'auth', undefined],
    [403, { code: 'synthetic_user_required' }, 'unavailable', undefined],
    [400, { code: 'attempt_id_required' }, 'unavailable', undefined],
    [503, { code: 'usage_control_unavailable' }, 'unavailable', undefined],
  ])('maps HTTP %i %j to %s (wait %s)', async (status, body, reason, wait) => {
    const error = await providerFailure(reply(status, body));
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toMatchObject({ reason, status });
    expect(error.retryAfterSeconds).toBe(wait);
  });

  it('prefers the wait in the body, falls back to Retry-After, and ignores nonsense', async () => {
    expect((await providerFailure(reply(429, { code: 'testing_limit', retry_after_seconds: 90 }, { 'Retry-After': '30' }))).retryAfterSeconds).toBe(90);
    expect((await providerFailure(reply(429, { code: 'testing_limit' }, { 'Retry-After': '30' }))).retryAfterSeconds).toBe(30);
    expect((await providerFailure(reply(429, { code: 'testing_limit', retry_after_seconds: -5 }, { 'Retry-After': 'soon' }))).retryAfterSeconds).toBeUndefined();
    expect((await providerFailure(reply(429, 'not json'))).reason).toBe('limit');
  });

  it('keeps an existing label for the message and leaves the response readable', async () => {
    const response = reply(502, { code: 'x' });
    const error = await providerFailure(response, 'AI request failed');
    expect(error.message).toBe('AI request failed (502).');
    expect(await response.json()).toEqual({ code: 'x' });
  });
});

describe('waitText', () => {
  it.each([
    [0, 'less than a minute'], [1, 'less than a minute'], [59, 'less than a minute'], [60, '1 minute'], [61, '2 minutes'],
    [120, '2 minutes'], [723, '13 minutes'], [1800, '30 minutes'], [NaN, 'less than a minute'],
  ])('says %s seconds as "%s"', (seconds, text) => expect(waitText(seconds)).toBe(text));
});

describe('asProviderError', () => {
  it('keeps typed errors, calls a missing session a sign-in problem, and anything else unavailable', () => {
    const typed = new ProviderUnavailableError('limit', 429);
    expect(asProviderError(typed)).toBe(typed);
    expect(asProviderError(new Error('Please sign in to use this feature.')).reason).toBe('auth');
    expect(asProviderError(new TypeError('Failed to fetch')).reason).toBe('unavailable');
    expect(asProviderError('nope').reason).toBe('unavailable');
  });
});
