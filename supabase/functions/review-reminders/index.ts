import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClient } from "../_shared/auth.ts";
import { sendPush } from "../_shared/webpush.ts";

/**
 * "How was it?" — after an event that included a sponsored venue, reminds
 * the host and the guests who went to review it and earn a credit.
 *
 * Called every hour by pg_cron (migration 20261014120000_review_reminders),
 * which proves itself with app_secrets.CRON_SECRET rather than a user
 * session. due_review_reminders() decides who is due: once per person per
 * event, 9am to 9pm Sydney time.
 */
const MAX_PER_RUN = 200;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const db = serviceClient();

  const { data: secret } = await db.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!secret?.value || given !== secret.value) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { ignore_quiet_hours?: boolean; plan_id?: string };

  const { data: due, error } = await db.rpc("due_review_reminders", { p_ignore_quiet_hours: body.ignore_quiet_hours === true });
  if (error) {
    console.error("[review-reminders] due_review_reminders failed", error.message);
    return new Response(JSON.stringify({ error: "Could not list reminders" }), { status: 500 });
  }
  const rows = ((due ?? []) as { plan_id: string; user_id: string; plan_title: string; venue_names: string[] }[])
    .filter((r) => !body.plan_id || r.plan_id === body.plan_id)
    .slice(0, MAX_PER_RUN);

  let notified = 0;
  let pushed = 0;
  for (const r of rows) {
    // Claim it first, so a slow or repeated run never reminds anyone twice.
    const { error: claimError } = await db.from("review_reminders").insert({ plan_id: r.plan_id, user_id: r.user_id });
    if (claimError) continue;

    const venues = r.venue_names.length === 1 ? r.venue_names[0] : `${r.venue_names.slice(0, -1).join(", ")} and ${r.venue_names.at(-1)}`;
    const title = `How was ${r.plan_title}?`;
    const text = `Leave a review of ${venues} and earn a credit.`;
    const data = { type: "review_reminder", plan_id: r.plan_id, url: `/#/plan/${r.plan_id}/dashboard` };

    const { error: noteError } = await db.from("notifications").insert({ user_id: r.user_id, type: "review_reminder", title, body: text, data });
    if (noteError) console.error("[review-reminders] notification insert failed", noteError.message);
    else notified++;
    const result = await sendPush(db, [r.user_id], { title, body: text, data });
    pushed += result.sent;
  }

  return new Response(JSON.stringify({ due: rows.length, notified, pushed }), {
    headers: { "Content-Type": "application/json" },
  });
});
