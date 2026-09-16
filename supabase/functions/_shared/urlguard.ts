/**
 * SSRF protection for endpoints that fetch a caller-supplied URL.
 *
 * extract-venue-meta takes any URL a user pastes and fetches it server-side,
 * returning an excerpt of the body. Without these checks that is a general
 * purpose request proxy sitting inside our infrastructure: a caller could
 * reach cloud metadata endpoints, internal services, or anything else the
 * function's network can see, and read the response back.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa"];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** RFC1918 + loopback + link-local + CGNAT + broadcast/multicast. */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return true; // malformed — refuse
  const ip = ipv4ToInt(parts);

  const ranges: [string, string][] = [
    ["0.0.0.0", "0.255.255.255"],
    ["10.0.0.0", "10.255.255.255"],
    ["100.64.0.0", "100.127.255.255"],
    ["127.0.0.0", "127.255.255.255"],
    ["169.254.0.0", "169.254.255.255"], // cloud metadata lives here
    ["172.16.0.0", "172.31.255.255"],
    ["192.0.0.0", "192.0.0.255"],
    ["192.168.0.0", "192.168.255.255"],
    ["198.18.0.0", "198.19.255.255"],
    ["224.0.0.0", "255.255.255.255"],
  ];
  return ranges.some(([lo, hi]) =>
    ip >= ipv4ToInt(lo.split(".").map(Number)) && ip <= ipv4ToInt(hi.split(".").map(Number))
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("fe80")) return true; // link-local
  // IPv4-mapped (::ffff:169.254.169.254)
  const mapped = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function assertPublicUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https links are supported." };
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: "That address is not reachable." };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "That address is not reachable." };
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, error: "That address is not reachable." };
  }
  // Bare hostname with no dot (e.g. "router") resolves on internal networks.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, error: "That address is not reachable." };
  }

  return { ok: true, url };
}

/**
 * fetch() that re-validates every hop. A public URL is free to redirect to
 * 169.254.169.254, so following redirects automatically would reopen exactly
 * the hole assertPublicUrl closes.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response | null> {
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = assertPublicUrl(current);
    if (!check.ok) return null;

    const res = await fetch(check.url.toString(), { ...init, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      await res.body?.cancel();
      current = new URL(location, check.url).toString();
      continue;
    }
    return res;
  }
  return null;
}
