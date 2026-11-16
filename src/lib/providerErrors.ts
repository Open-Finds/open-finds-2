export type ProviderReason =
  | 'auth' | 'busy' | 'duplicate' | 'limit' | 'unavailable'
  /** The staging testing allowance of AI Save attempts is used up for now; the wait is in `retryAfterSeconds`. */
  | 'testing_limit'
  /** The attempt id is too old for the server to accept. A new attempt starts on retry. */
  | 'attempt_expired'
  /** The attempt made too many requests. A new attempt starts on retry. */
  | 'attempt_limit';

/**
 * A paid-provider call was refused or could not run (sign-in, an access or
 * budget gate, an outage). It says nothing about whether a venue is real, so
 * screens must not present it as "could not verify" or "could not identify".
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly reason: ProviderReason, readonly status?: number, readonly code?: string, message?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message ?? `Provider unavailable (${[reason, status, code].filter(Boolean).join(' ')})`);
    this.name = 'ProviderUnavailableError';
  }
}

function reasonFor(status: number, code?: string): ProviderReason {
  if (code === 'testing_limit') return 'testing_limit';
  if (code === 'attempt_expired') return 'attempt_expired';
  if (code === 'attempt_request_limit') return 'attempt_limit';
  if (status === 401) return 'auth';
  if (status === 409) return code === 'duplicate_request' ? 'duplicate' : 'busy';
  if (status === 429) return 'limit';
  return 'unavailable';
}

/** "13 minutes", "1 minute", or "less than a minute". */
export function waitText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * Turns a failed edge-function response into a typed error. Leaves the body
 * readable. `label` keeps an existing message such as "AI request failed (502)".
 */
export async function providerFailure(res: Response, label?: string): Promise<ProviderUnavailableError> {
  const body = await res.clone().json().catch(() => null) as { code?: unknown; retry_after_seconds?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  const fromBody = typeof body?.retry_after_seconds === 'number' ? body.retry_after_seconds : NaN;
  const fromHeader = Number(res.headers.get('Retry-After'));
  const wait = [fromBody, fromHeader].find((value) => Number.isFinite(value) && value > 0);
  return new ProviderUnavailableError(
    reasonFor(res.status, code), res.status, code, label ? `${label} (${res.status}).` : undefined, wait,
  );
}

/** Any failure to reach a provider (no session, no network, a timeout) as a typed error. */
export function asProviderError(error: unknown): ProviderUnavailableError {
  if (error instanceof ProviderUnavailableError) return error;
  return new ProviderUnavailableError(error instanceof Error && /sign in/i.test(error.message) ? 'auth' : 'unavailable');
}
