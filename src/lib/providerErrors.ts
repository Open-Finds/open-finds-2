export type ProviderReason = 'auth' | 'busy' | 'duplicate' | 'limit' | 'unavailable';

/**
 * A paid-provider call was refused or could not run (sign-in, an access or
 * budget gate, an outage). It says nothing about whether a venue is real, so
 * screens must not present it as "could not verify" or "could not identify".
 */
export class ProviderUnavailableError extends Error {
  constructor(readonly reason: ProviderReason, readonly status?: number, readonly code?: string, message?: string) {
    super(message ?? `Provider unavailable (${[reason, status, code].filter(Boolean).join(' ')})`);
    this.name = 'ProviderUnavailableError';
  }
}

function reasonFor(status: number, code?: string): ProviderReason {
  if (status === 401) return 'auth';
  if (status === 409) return code === 'duplicate_request' ? 'duplicate' : 'busy';
  if (status === 429) return 'limit';
  return 'unavailable';
}

/**
 * Turns a failed edge-function response into a typed error. Leaves the body
 * readable. `label` keeps an existing message such as "AI request failed (502)".
 */
export async function providerFailure(res: Response, label?: string): Promise<ProviderUnavailableError> {
  const body = await res.clone().json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  return new ProviderUnavailableError(reasonFor(res.status, code), res.status, code, label ? `${label} (${res.status}).` : undefined);
}

/** Any failure to reach a provider (no session, no network, a timeout) as a typed error. */
export function asProviderError(error: unknown): ProviderUnavailableError {
  if (error instanceof ProviderUnavailableError) return error;
  return new ProviderUnavailableError(error instanceof Error && /sign in/i.test(error.message) ? 'auth' : 'unavailable');
}
