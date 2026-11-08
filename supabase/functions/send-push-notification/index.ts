import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { json, preflight } from "../_shared/cors.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { sendPush } from "../_shared/webpush.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
type Db = ReturnType<typeof serviceClient>;
type Note = { user_id: string; type: string; title: string; body: string; data: Record<string, unknown>; event: string };

// Authorize the whole batch before any side effect. Ignore caller text/URLs.
async function socialNotes(db: Db, body: Record<string, unknown>, caller: string): Promise<Note[] | null> {
  const raw = body.user_ids ?? (body.user_id ? [body.user_id] : []);
  if (!Array.isArray(raw) || !raw.length || raw.length > 100 || !raw.every(isId)) return null;
  const recipients = [...new Set(raw)];
  const notes: Note[] = [];
  if (body.type === "friend_request" || body.type === "friend_accepted") {
    const pending = body.type === "friend_request";
    for (const recipient of recipients) {
      if (recipient === caller) return null;
      const { data: row, error } = await db.from("friendships").select("id")
        .eq("requester_id", pending ? caller : recipient)
        .eq("addressee_id", pending ? recipient : caller)
        .eq("status", pending ? "pending" : "accepted").maybeSingle();
      if (error) throw error;
      if (!row) return null;
      notes.push({ user_id: recipient, type: body.type,
        title: pending ? "New friend request" : "Friend request accepted",
        body: pending ? "Someone wants to be your friend" : "You are now friends",
        data: { from_user_id: caller }, event: body.type + ":" + row.id + ":" + recipient });
    }
    return notes;
  }
  if (body.type !== "plan_invite") return null;
  const data = body.data as Record<string, unknown> | null;
  if (!data || !isId(data.plan_id)) return null;
  const planId = data.plan_id;
  const { data: plan, error: planError } = await db.from("plans").select("owner_id").eq("id", planId).maybeSingle();
  if (planError) throw planError;
  if (!plan || plan.owner_id !== caller) return null;
  const { data: invites, error: inviteError } = await db.from("plan_invites")
    .select("id, invited_user_id, group_id").eq("plan_id", planId).eq("invited_by", caller);
  if (inviteError) throw inviteError;
  const groupIds = (invites ?? []).filter((i) => i.group_id).map((i) => i.group_id);
  const members = groupIds.length
    ? await db.from("friend_group_members").select("group_id, user_id").in("group_id", groupIds)
    : { data: [], error: null };
  if (members.error) throw members.error;
  for (const recipient of recipients) {
    const invite = (invites ?? []).find((i) => i.invited_user_id === recipient
      || (i.group_id && members.data?.some((m) => m.group_id === i.group_id && m.user_id === recipient)));
    if (!invite) return null;
    notes.push({ user_id: recipient, type: "plan_invite", title: "New event invite",
      body: invite.group_id ? "Your group has been invited to an event" : "You have been invited to an event",
      data: { plan_id: planId, from_user_id: caller, url: "/#/plan/" + planId },
      event: "plan_invite:" + invite.id + ":" + recipient });
  }
  return notes;
}

export async function handleRequest(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(req, { error: "A JSON object is required" }, 400);
    const guest = body.plan_id !== undefined || body.rsvp_name !== undefined;
    let caller: string | null = null;
    if (!guest) {
      const auth = await requireUser(req);
      if (!auth.ok) return json(req, { error: auth.error }, auth.status);
      caller = auth.user.id;
      const limit = await consumeRateLimit("push-caller", caller, 60, 3600, { failClosed: true });
      if (!limit.available) return json(req, { error: "Notification checks unavailable" }, 503);
      if (!limit.allowed) return json(req, { error: "Rate limit reached" }, 429);
    }
    const db = serviceClient();
    let notes: Note[] | null;
    if (guest) {
      if (!isId(body.plan_id) || typeof body.rsvp_name !== "string" || !body.rsvp_name.trim()
        || body.rsvp_name.trim().length > 80) return json(req, { error: "A valid plan and RSVP name are required" }, 400);
      const name = body.rsvp_name.trim();
      const limit = await consumeRateLimit("push-guest-plan", body.plan_id, 120, 3600, { failClosed: true });
      if (!limit.available) return json(req, { error: "Notification checks unavailable" }, 503);
      if (!limit.allowed) return json(req, { error: "Rate limit reached" }, 429);
      const { data: plan, error: planError } = await db.from("plans").select("owner_id").eq("id", body.plan_id).maybeSingle();
      if (planError) throw planError;
      const { data: rsvp, error: rsvpError } = await db.from("rsvps").select("id, status")
        .eq("plan_id", body.plan_id).eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (rsvpError) throw rsvpError;
      if (!plan || !rsvp || !["in", "declined"].includes(rsvp.status)) return json(req, { error: "No matching RSVP" }, 403);
      if (!plan.owner_id) return json(req, { sent: 0, failed: 0, total: 0, notified: false });
      const coming = rsvp.status === "in";
      notes = [{ user_id: plan.owner_id, type: "rsvp",
        title: coming ? name + " is coming!" : name + " can't make it",
        body: coming ? name + ' just RSVP\'d "I\'m In" to your plan.' : name + " just declined your plan.",
        data: { type: "rsvp", plan_id: body.plan_id, url: "/#/plan/" + body.plan_id + "/dashboard" },
        event: "rsvp:" + rsvp.id + ":" + rsvp.status }];
    } else {
      notes = await socialNotes(db, body, caller!);
    }
    if (!notes) return json(req, { error: "Notification event or recipients are not authorized" }, 403);
    let sent = 0;
    let failed = 0;
    let notified = 0;
    for (const note of notes) {
      // Atomic existing RPC provides seven-day replay suppression across
      // edge instances without a schema change. On outages, fail closed.
      const claim = await consumeRateLimit("push-event", note.event, 1, 7 * 86400, { failClosed: true });
      if (!claim.available) return json(req, { error: "Notification checks unavailable" }, 503);
      if (!claim.allowed) continue;
      const { event: _event, ...record } = note;
      void _event;
      const { error } = await db.from("notifications").insert(record);
      if (error) throw error;
      notified++;
      const result = await sendPush(db, [note.user_id], { title: note.title, body: note.body, data: note.data });
      sent += result.sent;
      failed += result.failed;
    }
    return json(req, { sent, failed, total: sent + failed, notified });
  } catch (error) {
    console.error("[push] notification failed", error instanceof Error ? error.message : "unknown error");
    return json(req, { error: "Could not send notification" }, 500);
  }
}

Deno.serve(handleRequest);
