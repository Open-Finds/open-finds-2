/**
 * Where Stripe should send the user back to when a payment method has to
 * leave the embedded checkout to authenticate.
 *
 * APP_URL wins when set. Otherwise the request's Origin is used, but only if
 * it is one of ALLOWED_ORIGINS (or that list is unset, as in local dev), so a
 * caller cannot make Stripe redirect a user to a site of their choosing.
 */
export function appOrigin(req: Request): string | null {
  const configuredUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (configuredUrl) return configuredUrl;

  const origin = req.headers.get("Origin") ?? "";
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;

  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(origin)) return null;
  return origin;
}
