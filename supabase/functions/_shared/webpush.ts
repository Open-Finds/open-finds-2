import * as webpush from "jsr:@negrel/webpush@0.5";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

function b64urlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The VAPID pair as JWKs. The runtime will not import a P-256 private key
 * from `d` alone ("'x' property of JsonWebKey is required"), so the public
 * key (the same value as the app's VITE_VAPID_PUBLIC_KEY: a base64url,
 * uncompressed 65-byte point) supplies x and y.
 */
async function buildVapidKeyPair(privateKeyB64Url: string, publicKeyB64Url: string) {
  const point = b64urlToBytes(publicKeyB64Url);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 public key");
  }
  const x = bytesToB64url(point.slice(1, 33));
  const y = bytesToB64url(point.slice(33, 65));
  const privateKeyJwk = { kty: "EC", crv: "P-256", x, y, d: privateKeyB64Url, ext: true };
  const publicKeyJwk = { kty: "EC", crv: "P-256", x, y, ext: true };

  return webpush.importVapidKeys(
    { privateKey: privateKeyJwk, publicKey: publicKeyJwk },
    { extractable: false },
  );
}

export type PushMessage = { title: string; body: string; data: Record<string, unknown> };
export type PushResult = { sent: number; failed: number; total: number; push?: "not_configured" | "misconfigured" };

/**
 * Sends one push to every phone/browser the users have allowed notifications
 * on, and forgets subscriptions the push service says are gone. Push is
 * best-effort: callers write the in-app notification first.
 */
export async function sendPush(db: SupabaseClient, userIds: string[], message: PushMessage): Promise<PushResult> {
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  if (!vapidPrivateKey || !vapidPublicKey) return { sent: 0, failed: 0, total: 0, push: "not_configured" };

  let vapidKeys: Awaited<ReturnType<typeof buildVapidKeyPair>>;
  try {
    vapidKeys = await buildVapidKeyPair(vapidPrivateKey, vapidPublicKey);
  } catch (err) {
    console.error("[push] VAPID keys are invalid", (err as Error).message);
    return { sent: 0, failed: 0, total: 0, push: "misconfigured" };
  }
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: "mailto:noreply@theunsaved.app",
    vapidKeys,
  });

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .in("user_id", userIds);
  if (!subs || subs.length === 0) return { sent: 0, failed: 0, total: 0 };

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    data: { ...message.data, url: (message.data.url as string | undefined) ?? "/" },
    icon: "/favicon.png",
    badge: "/favicon.png",
  });

  let sent = 0;
  let failed = 0;
  const staleEndpoints: string[] = [];
  for (const sub of subs) {
    try {
      const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } } as unknown as PushSubscription;
      await appServer.subscribe(pushSub).pushTextMessage(payload, { urgency: "normal" });
      sent++;
    } catch (err) {
      failed++;
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 410) staleEndpoints.push(sub.endpoint);
    }
  }
  if (staleEndpoints.length > 0) {
    await db.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }
  return { sent, failed, total: subs.length };
}
