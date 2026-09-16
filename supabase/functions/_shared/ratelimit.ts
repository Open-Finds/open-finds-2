import { serviceClient } from "./auth.ts";

/**
 * Fixed-window rate limiting, counted in Postgres so the limit holds across
 * edge instances. Fails OPEN: if the limiter itself errors we let the request
 * through rather than taking the feature down, on the basis that these limits
 * exist to bound cost abuse, not to gate correctness.
 */
export async function consumeRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  try {
    const { data, error } = await serviceClient().rpc("consume_rate_limit", {
      p_key: `${bucket}:${subject}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data) {
      console.warn("[ratelimit] check failed, allowing request", error?.message);
      return { allowed: true, remaining: limit, retryAfter: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfter: Number(row.retry_after ?? windowSeconds),
    };
  } catch (err) {
    console.warn("[ratelimit] threw, allowing request", String(err));
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}
