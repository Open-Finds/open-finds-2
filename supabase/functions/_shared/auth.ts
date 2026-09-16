import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Resolves the calling END USER, not merely "someone holding a key".
 *
 * This distinction is the whole point. The anon key ships inside the browser
 * bundle and is a structurally valid JWT, so Supabase's own verify_jwt gate is
 * satisfied by anyone who reads the JavaScript. Functions that spend money —
 * OpenRouter, Google Maps — must additionally prove a real signed-in user is
 * behind the request, which is what auth.getUser() does.
 */
export type AuthedUser = { id: string; email: string | null };

export async function requireUser(req: Request): Promise<
  { ok: true; user: AuthedUser } | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKey = req.headers.get("apikey") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Authentication required" };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Authentication required" };
  }

  // A bare anon key in the Authorization slot is not a user session.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (token === anonKey || (apiKey && token === apiKey)) {
    return { ok: false, status: 401, error: "A signed-in user session is required" };
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Invalid or expired session" };
  }

  return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
}

/** Service-role client. Never hand this to anything caller-controlled. */
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
