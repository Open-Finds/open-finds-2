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
    ["192.0.2.0", "192.0.2.255"],
    ["192.88.99.0", "192.88.99.255"],
    ["192.168.0.0", "192.168.255.255"],
    ["198.18.0.0", "198.19.255.255"],
    ["198.51.100.0", "198.51.100.255"],
    ["203.0.113.0", "203.0.113.255"],
    ["224.0.0.0", "255.255.255.255"],
  ];
  return ranges.some(([lo, hi]) =>
    ip >= ipv4ToInt(lo.split(".").map(Number)) && ip <= ipv4ToInt(hi.split(".").map(Number))
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  // Accept native global unicast only. This excludes all mapped/compatible
  // IPv4, NAT64, loopback, unique-local, link-local (/10) and multicast forms,
  // including the hexadecimal form produced by the WHATWG URL parser.
  const first = Number.parseInt(h.split(":")[0], 16);
  const second = Number.parseInt(h.split(":")[1] || "0", 16);
  return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff
    || (first === 0x2001 && second < 0x200) // special/transition allocations
    || h.startsWith("2001:db8:") || first === 0x2002 || first === 0x3fff;
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
  if (url.username || url.password) return { ok: false, error: "Links containing credentials are not supported." };

  const host = url.hostname.toLowerCase().replace(/\.+$/, "");

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

/** Preflight every DNS answer, including each redirect destination. A hostname
 * must not resolve to a mix of public and private addresses. Network-level
 * egress restrictions are still needed to eliminate DNS rebinding between
 * this lookup and fetch's own connection lookup. */
async function publicDestination(raw: string): Promise<URL | null> {
  const check = assertPublicUrl(raw);
  if (!check.ok) return null;
  const host = check.url.hostname.replace(/\.+$/, "");
  if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return check.url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 3000); }),
    ]);
    const addresses: string[] = [];
    for (const answer of answers) {
      if (answer.status === "fulfilled") addresses.push(...answer.value);
      else if (answer.reason?.name !== "NotFound") return null;
    }
    if (!addresses.length || addresses.some((address) => {
      const literal = address.includes(":") ? `[${address}]` : address;
      return !assertPublicUrl(`https://${literal}/`).ok;
    })) return null;
    return check.url;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where a link ends up, checking every hop the same way safeFetch does. Used
 * for share links (vm.tiktok.com/…) that only reveal the real page once
 * followed. Returns the last address it could reach; the body is never read.
 */
export async function followRedirects(raw: string, maxRedirects = 5): Promise<string> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const destination = await publicDestination(current);
    if (!destination) return hop === 0 ? raw : current;
    let res: Response;
    try {
      res = await fetch(destination.toString(), {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
        },
      });
    } catch {
      return current;
    }
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, destination).toString();
      if (!assertPublicUrl(next).ok) return current;
      current = next;
      continue;
    }
    return current;
  }
  return current;
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
    const destination = await publicDestination(current);
    if (!destination) return null;

    const res = await fetch(destination.toString(), { ...init, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      await res.body?.cancel();
      current = new URL(location, destination).toString();
      continue;
    }
    return res;
  }
  return null;
}
