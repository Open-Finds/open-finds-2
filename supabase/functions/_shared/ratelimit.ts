import { serviceClient } from "./auth.ts";

/**
 * Fixed-window rate limiting, counted in Postgres so the limit holds across
 * edge instances. Callers using limits as a security/cost boundary opt into
 * failClosed; ordinary map lookups retain the previous availability policy.
 */
export async function consumeRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  options: { failClosed?: boolean } = {},
): Promise<{ allowed: boolean; remaining: number; retryAfter: number; available: boolean }> {
  const unavailable = () => ({
    allowed: !options.failClosed, remaining: options.failClosed ? 0 : limit,
    retryAfter: options.failClosed ? 60 : 0, available: false,
  });
  try {
    const { data, error } = await serviceClient().rpc("consume_rate_limit", {
      p_key: `${bucket}:${subject}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data) {
      console.warn("[ratelimit] check failed", error?.message);
      return unavailable();
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return unavailable();
    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfter: Number(row.retry_after ?? windowSeconds),
      available: true,
    };
  } catch (err) {
    console.warn("[ratelimit] threw", String(err));
    return unavailable();
  }
}
